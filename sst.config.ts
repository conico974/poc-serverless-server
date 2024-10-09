/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
	app(input) {
		return {
			name: "poc-serverless-server",
			removal: input?.stage === "production" ? "retain" : "remove",
			home: "aws",
			region: "eu-west-3",
		};
	},
	async run() {
		const fn = new sst.aws.Function("poc-serverless-server", {
			handler: "packages/lambda/src/index.handler",
			nodejs: {
				install: ["bufferutil"],
			},
			url: true,
			timeout: "3 minutes",
			environment: {
				// Max time (in ms) the lambda stay up, after this time it will try to close the connection
				MAX_UPTIME: "150000",
				// Time (in ms) the lambda will wait after all the connections are closed to close the websocket connection - You will be charged for this time
				LAMBDA_AFTeR_TIMEOUT: "5000",
			},
		});

		return {
			function: fn.url,
		};
	},
});
