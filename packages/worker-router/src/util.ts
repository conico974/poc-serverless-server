// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export class DetachedPromise<T = any> {
	public readonly resolve: (value: T | PromiseLike<T>) => void;
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	public readonly reject: (reason: any) => void;
	public readonly promise: Promise<T>;

	constructor() {
		let resolve: (value: T | PromiseLike<T>) => void;
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		let reject: (reason: any) => void;

		// Create the promise and assign the resolvers to the object.
		this.promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});

		// We know that resolvers is defined because the Promise constructor runs
		// synchronously.
		// biome-ignore lint/style/noNonNullAssertion: <explanation>
		this.resolve = resolve!;
		// biome-ignore lint/style/noNonNullAssertion: <explanation>
		this.reject = reject!;
	}
}

export class DetachedReadableStream {
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	stream: ReadableStream<any>;
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	enqueue: (value: any) => void;
	close: () => void;
	constructor(req: Request) {
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		let enqueue!: (value: any) => void;
		let close!: () => void;
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		this.stream = new ReadableStream<any>({
			start(controller) {
				enqueue = controller.enqueue.bind(controller);
				close = controller.close.bind(controller);
			},
		});
		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		this.enqueue = (value: any) => {
			try {
				enqueue(value);
			} catch (e) {
				// Ignore this, it happens when the stream is closed.
			}
		};
		this.close = () => {
			try {
				close();
			} catch (e) {
				// Ignore this, it happens when the stream is closed.
			}
		};
	}
}
