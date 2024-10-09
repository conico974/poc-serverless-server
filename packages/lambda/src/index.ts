import { withWsHandler, lambdaId } from "./runtime";

export const handler = withWsHandler(async (event, stream) => {
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
});
