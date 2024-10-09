import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { WebSocket } from "ws";
import type {
	WsIncomingRequest,
	WsInitialIncomingRequest,
	WsOutgoingRequest,
} from "@poc/types";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
const lambdaId = Math.random().toString();

class CustomWritableStream extends Writable {
	private headersSent = false;
	constructor(
		private ws: WebSocket,
		private requestId: string,
		private cb: () => void,
		private serverId: string,
	) {
		super();
	}

	private send(data: WsOutgoingRequest, cb?: () => void) {
		this.ws.send(JSON.stringify(data), cb);
	}

	writeHeaders(headers: Record<string, string>) {
		if (this.headersSent) {
			throw new Error("Headers already sent");
		}
		this.send(
			{
				type: "outgoing-headers",
				requestId: this.requestId,
				headers,
				serverId: this.serverId,
			},
			() => console.timeEnd("wsToFirstMessage"),
		);
		this.headersSent = true;
	}

	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	_write(chunk: any, encoding: any, callback: any) {
		if (!this.headersSent) {
			throw new Error("Headers not sent");
		}
		this.send({
			type: "outgoing-data",
			requestId: this.requestId,
			data: chunk.toString(),
			serverId: this.serverId,
		});
		callback();
	}

	_final(callback: (error?: Error | null) => void): void {
		this.send({
			type: "outgoing-close",
			requestId: this.requestId,
			serverId: this.serverId,
		});
		this.cb();
		callback();
	}
}

class WebSocketHandler {
	ws: WebSocket;
	activeConnections: Map<string, CustomWritableStream> = new Map();
	private resolve!: () => void;
	private reject!: (error: Error) => void;
	promise = new Promise<void>((resolve, reject) => {
		this.resolve = resolve;
		this.reject = reject;
	});
	activeTimeout: Timer | null = null;

	constructor(
		private handler: (
			event: WsIncomingRequest,
			stream: CustomWritableStream,
		) => Promise<void>,
		private serverId: string,
	) {
		console.time("ws");
		console.time("wsToOpen");
		console.time("wsToFirstMessage");
		// biome-ignore lint/style/noNonNullAssertion: <explanation>
		this.ws = new WebSocket(process.env.WORKER_URL!, {
			headers: {
				"x-server-id": this.serverId,
			},
			perMessageDeflate: false,
			skipUTF8Validation: true,
		});
		console.timeEnd("ws");

		this.ws.on("open", () => {
			this.ws.send(JSON.stringify({ type: "ready", serverId }), () =>
				console.timeEnd("wsToOpen"),
			);
			// this.handleIncomingRequest(initialIncomingRequest);
		});

		this.ws.on("message", (data) => {
			const message = JSON.parse(data.toString()) as WsIncomingRequest;
			this.handleIncomingRequest(message);
		});

		// After 10 minutes we want to close the connection anyway
		setTimeout(
			() => {
				this.ws.send(JSON.stringify({ type: "closing", serverId }));
				// Here we'll need to await for all the stream to finish
				Promise.allSettled(
					Array.from(this.activeConnections.values()).map((stream) =>
						finished(stream),
					),
				).then(() => {
					this.resolve();
				});
			},
			10 * 60 * 1000,
		);
	}

	private handleIncomingRequest(req: WsIncomingRequest) {
		// On new incoming request, we want to clear the timeout
		//TODO: Closing should be handled by the server
		if (this.activeTimeout) {
			clearTimeout(this.activeTimeout);
			this.activeTimeout = null;
		}
		// Create a new stream for each incoming request
		const stream = new CustomWritableStream(
			this.ws,
			req.requestId,
			() => {
				this.activeConnections.delete(req.requestId);
				// Check if the activeConnections map is empty
				// If it is, set a timeout to close the connection
				if (this.activeConnections.size === 0) {
					this.activeTimeout = setTimeout(() => {
						this.ws.close(
							1000,
							JSON.stringify({ type: "closing", serverId: this.serverId }),
						);
						this.resolve();
					}, 5000);
				}
			},
			this.serverId,
		);
		this.activeConnections.set(req.requestId, stream);
		this.handler(req, stream);
	}
}
export const handler: APIGatewayProxyHandlerV2 = async (event, context) => {
	if (!event.body) {
		return {
			statusCode: 400,
			body: JSON.stringify({ message: "No body provided" }),
		};
	}

	const { serverId, host } = JSON.parse(event.body) as WsInitialIncomingRequest;
	process.env.WORKER_URL = `wss://${host}/websocket`;
	const wsHandler = new WebSocketHandler(async (event, stream) => {
		stream.writeHeaders({
			"Content-Type": "text/event-stream",
			"x-what": "what",
			"Transfer-Encoding": "chunked",
		});
		stream.write(`Hello, World!${new Date().toISOString()}, ${lambdaId}\n\n`);
		stream.write(`Lambda ID: ${lambdaId}\n\n`);
		stream.write(
			`Incoming request: ${JSON.stringify(event)}, ${new Date().toISOString()} \n\n`,
		);
		await new Promise((resolve) => {
			setTimeout(resolve, 1000);
		});
		stream.write(`After 1s ${new Date().toISOString()}\n\n`);
		await new Promise((resolve) => {
			setTimeout(resolve, 1000);
		});
		stream.write(`After 2s ${new Date().toISOString()}\n\n`);
		await new Promise((resolve) => {
			setTimeout(resolve, 1000);
		});
		stream.write(`After 3s ${new Date().toISOString()}\n\n`);
		stream.end(`ending stream${new Date().toISOString()}\n\n`);
	}, serverId);

	await wsHandler.promise;

	return {
		statusCode: 200,
		body: JSON.stringify({ message: "Hello, World!" }),
	};
}; // lambda async handler
