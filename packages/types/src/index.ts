export interface WsRequestIncomingHeaders {
	type: "incoming-headers";
	requestId: string;
	headers: Record<string, string>;
}

export interface WsRequestIncomingData {
	type: "incoming-data";
	requestId: string;
	data: string;
}

export interface WsRequestIncomingClose {
	type: "incoming-close";
	requestId: string;
}

export interface WsRequestOutgoingAck {
	type: "outgoing-ack";
	requestId: string;
}

export interface WsRequestOutgoingHeaders {
	type: "outgoing-headers";
	headers: Record<string, string>;
	requestId: string;
	serverId: string;
}

export interface WsRequestOutgoingReady {
	type: "ready";
	serverId: string;
}

export interface WsRequestOutgoingData {
	type: "outgoing-data";
	data: string;
	requestId: string;
	serverId: string;
}

export interface WsRequestOutgoingClose {
	type: "outgoing-close";
	requestId: string;
	serverId: string;
}

export interface WsClosing {
	type: "closing";
	serverId: string;
}

//TODO: handle incoming streaming request
export type WsIncomingRequest = {
	type: "incoming";
	requestId: string;
	headers: Record<string, string>;
	data: string;
};

export type WsInitialIncomingRequest = {
	type: "initial";
	requestId: string;
	serverId: string;
	host: string;
};

export type WsOutgoingRequest =
	| WsRequestOutgoingHeaders
	| WsRequestOutgoingData
	| WsRequestOutgoingClose
	| WsRequestOutgoingReady;
