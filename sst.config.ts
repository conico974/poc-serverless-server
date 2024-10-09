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
			handler: "packages/lambda/index.handler",
			nodejs: {
				install: ["bufferutil"],
			},
			url: true,
			timeout: "3 minutes",
		});

		return {
			function: fn.url,
		};
	},
});
