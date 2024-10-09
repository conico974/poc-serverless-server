import { DurableObject } from "cloudflare:workers";
import { DetachedPromise, DetachedReadableStream } from "./util";
import type {
	WsClosing,
	WsInitialIncomingRequest,
	WsOutgoingRequest,
} from "@poc/types";

export interface Env {
	WEBSOCKET_SERVER: DurableObjectNamespace<WebSocketServer>;
	WEBSOCKET_ROUTER: DurableObjectNamespace<WebSocketRouter>;
	LAMBDA_URL: string;
}

const MAX_NUMBER_CONNECTIONS = 5;

// Worker
export default {
	async fetch(request, env, ctx): Promise<Response> {
		try {
			if (request.url.endsWith("/websocket")) {
				//TODO: Obviously this one need to be secured
				const serverId = request.headers.get("x-server-id");
				if (!serverId) {
					return new Response("Server id not provided", {
						status: 403,
					});
				}
				const id = env.WEBSOCKET_SERVER.idFromName(serverId);
				const stub = env.WEBSOCKET_SERVER.get(id);
				// Expect to receive a WebSocket Upgrade request.
				// If there is one, accept the request and return a WebSocket Response.
				const upgradeHeader = request.headers.get("Upgrade");
				if (!upgradeHeader || upgradeHeader !== "websocket") {
					return new Response("Durable Object expected Upgrade: websocket", {
						status: 426,
					});
				}
				console.log("Upgrading to WebSocket");

				return stub.fetch(request).catch((e) => {
					console.error(e);
					return new Response("Internal Server Error", {
						status: 500,
					});
				});
			}

			const router = env.WEBSOCKET_ROUTER.get(
				env.WEBSOCKET_ROUTER.idFromName("router"),
			);
			const availableLambdaId = await router.getAvailableLambda();
			const serverId = availableLambdaId ?? Math.random().toString();
			const requestId = Math.random().toString();
			const id = env.WEBSOCKET_SERVER.idFromName(serverId);
			const lambda = env.WEBSOCKET_SERVER.get(id);
			await lambda.createRequest(
				requestId,
				serverId,
				request.headers.get("host") || "",
			);
			ctx.waitUntil(
				availableLambdaId
					? router.addConnection(serverId)
					: router.createLambda(serverId),
			);

			//TODO: modify request to include both server id and request id
			const clonedRequest = new Request(request);
			clonedRequest.headers.set("x-server-id", serverId);
			clonedRequest.headers.set("x-request-id", requestId);

			return lambda.fetch(clonedRequest);
		} catch (e) {
			console.error(e);
			return new Response("Internal Server Error", {
				status: 500,
			});
		}
	},
} satisfies ExportedHandler<Env>;

interface Connection {
	id: string;
	activeConnections: number;
	status: "pending" | "ready" | "closing";
}

export class WebSocketRouter extends DurableObject<Env> {
	protected ctx: DurableObjectState;
	private activeConnMap: Map<string, Connection> = new Map();
	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.ctx = state;
		this.ctx.storage.list().then((activeConnMap) => {
			this.activeConnMap = activeConnMap as Map<string, Connection>;
		});
	}

	async getAvailableLambda(): Promise<string | undefined> {
		return Array.from(this.activeConnMap.values()).find(
			(lambda) =>
				lambda.activeConnections < MAX_NUMBER_CONNECTIONS &&
				lambda.status === "ready",
		)?.id;
	}

	private setInStorage(id: string, data: Connection) {
		this.ctx.waitUntil(this.ctx.storage.put(id, data));
	}

	async setStatus(id: string, status: Connection["status"]) {
		const current = this.activeConnMap.get(id);
		if (!current) {
			throw new Error("Lambda not found");
		}
		const newValue = {
			...current,
			status,
		};
		this.setInStorage(id, newValue);
		this.activeConnMap.set(id, newValue);
	}

	async addConnection(id: string) {
		const current = this.activeConnMap.get(id);
		if (!current) {
			throw new Error("Lambda not found");
		}
		const newValue = {
			...current,
			activeConnections: current.activeConnections + 1,
		};
		this.setInStorage(id, newValue);
		this.activeConnMap.set(id, newValue);
	}

	async removeConnection(id: string) {
		const current = this.activeConnMap.get(id);
		if (!current) {
			throw new Error("Lambda not found");
		}
		const newValue = {
			...current,
			activeConnections: Math.max(current.activeConnections - 1, 0),
		};
		this.setInStorage(id, newValue);
		this.activeConnMap.set(id, newValue);
	}

	async deleteLambda(id: string) {
		this.activeConnMap.delete(id);
		this.ctx.waitUntil(this.ctx.storage.delete(id));
	}

	async createLambda(id: string) {
		const newValue = {
			id,
			activeConnections: 0,
			status: "pending" as const,
		};
		this.setInStorage(id, newValue);
		this.activeConnMap.set(id, newValue);
	}
}

// Durable Object
export class WebSocketServer extends DurableObject<Env> {
	responses: Map<string, DetachedPromise<Response>> = new Map();
	bodyStreams: Map<string, DetachedReadableStream> = new Map();
	sockets: {
		client: WebSocket;
		server: WebSocket;
	};
	onGoingLambdaResponse: Promise<Response> | null = null;
	isReady: DetachedPromise<void> = new DetachedPromise();
	maxNumberConnections = MAX_NUMBER_CONNECTIONS;
	ctx: DurableObjectState;
	router: DurableObjectStub<WebSocketRouter>;

	constructor(ctx: DurableObjectState, env: Env) {
		// This is reset whenever the constructor runs because
		// regular WebSockets do not survive Durable Object resets.
		//
		// WebSockets accepted via the Hibernation API can survive
		// a certain type of eviction, but we will not cover that here.
		super(ctx, env);
		this.env = env;
		const pairSocket = new WebSocketPair();
		this.sockets = {
			client: pairSocket[0],
			server: pairSocket[1],
		};
		this.router = env.WEBSOCKET_ROUTER.get(
			env.WEBSOCKET_ROUTER.idFromName("router"),
		);

		this.ctx = ctx;
	}

	async fetchWs(request: Request): Promise<Response> {
		// Creates two ends of a WebSocket connection.
		const { client, server } = this.sockets;
		const encoder = new TextEncoder();

		// Calling `accept()` tells the runtime that this WebSocket is to begin terminating
		// request within the Durable Object. It has the effect of "accepting" the connection,
		// and allowing the WebSocket to send and receive messages.
		server.accept();

		// Upon receiving a message from the client, the server replies with the same message,
		// and the total number of connections with the "[Durable Object]: " prefix
		server.addEventListener("message", (event: MessageEvent) => {
			const data = event.data as string;
			const chunksData = JSON.parse(data) as WsOutgoingRequest;
			if (chunksData.type === "ready") {
				this.isReady.resolve();
				this.ctx.waitUntil(this.router.setStatus(chunksData.serverId, "ready"));
				return;
			}
			const req = this.responses.get(chunksData.requestId);
			if (!req) {
				throw new Error("Request not found");
			}
			if (chunksData.type === "outgoing-headers") {
				const detachedStream = this.bodyStreams.get(chunksData.requestId);
				if (!detachedStream) {
					throw new Error("Stream not found");
				}
				this.bodyStreams.set(chunksData.requestId, detachedStream);
				const stream = detachedStream.stream;
				const resp = new Response(stream, {
					headers: chunksData.headers,
				});
				req.resolve(resp);
			} else if (chunksData.type === "outgoing-data") {
				const stream = this.bodyStreams.get(chunksData.requestId);
				if (!stream) {
					throw new Error("Stream not found");
				}
				stream.enqueue(encoder.encode(chunksData.data));
			} else if (chunksData.type === "outgoing-close") {
				const stream = this.bodyStreams.get(chunksData.requestId);
				if (!stream) {
					throw new Error("Stream not found");
				}
				stream.close();
				this.ctx.waitUntil(this.router.removeConnection(chunksData.serverId));

				this.bodyStreams.delete(chunksData.requestId);
			}
		});

		// If the client closes the connection, the runtime will close the connection too.
		server.addEventListener("close", (cls: CloseEvent) => {
			console.log(
				`WebSocket closed with code ${cls.code}, reason: ${cls.reason}`,
			);
			const closeData = JSON.parse(cls.reason) as WsClosing;
			this.ctx.waitUntil(this.router.deleteLambda(closeData.serverId));
			server.close(cls.code, "Durable Object is closing WebSocket");
		});

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	async fetch(request: Request): Promise<Response> {
		if (request.url.endsWith("/websocket")) {
			return this.fetchWs(request);
		}
		const serverId = request.headers.get("x-server-id");
		const requestId = request.headers.get("x-request-id");
		if (!serverId) {
			throw new Error("Server id not provided");
		}
		if (!requestId) {
			throw new Error("Request id not provided");
		}
		const detachedPromise = this.responses.get(requestId);

		if (!detachedPromise) {
			throw new Error("Request not found");
		}
		this.bodyStreams.set(requestId, new DetachedReadableStream(request));
		await this.isReady.promise;
		this.sockets.server.send(
			JSON.stringify({
				type: "incoming",
				requestId,
				serverId,
				headers: {
					"content-type": request.headers.get("content-type") || "",
				},
				data: "",
			}),
		);

		return detachedPromise.promise;
	}

	async createRequest(requestId: string, serverId: string, host: string) {
		const detachedPromise = new DetachedPromise<Response>();
		this.responses.set(requestId, detachedPromise);
		if (this.onGoingLambdaResponse === null) {
			const body: WsInitialIncomingRequest = {
				type: "initial",
				requestId,
				serverId,
				host,
			};
			//@ts-ignore
			this.onGoingLambdaResponse = fetch(`${this.env.LAMBDA_URL}/invoke`, {
				method: "POST",
				body: JSON.stringify(body),
			}).catch((e) => {
				console.error("fetch failed", e);
				this.onGoingLambdaResponse = null;
			});
		}
	}
}
