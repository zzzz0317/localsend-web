import { encodeBase64 } from "~/utils/base64";

let connection: SignalingConnection | null = null;

export function getSignalingConnection() {
    return connection;
}

export function setSignalingConnection(conn: SignalingConnection | null) {
    connection = conn;
}

export class SignalingConnection {
    private _socket: WebSocket;
    private _onMessage: OnMessageCallback;
    private _onClose: () => void;

    private constructor(socket: WebSocket, onMessage: OnMessageCallback, onClose: () => void) {
        this._socket = socket;
        this._onMessage = onMessage;
        this._onClose = onClose;
    }

    /**
     * Connects to the signaling server.
     * @param url The URL of the signaling server.
     * @param info The client info to send to the server.
     * @param onMessage The callback to call when a message is received.
     * @param onClose The callback to call when the connection is closed.
     */
    public static async connect({
        url,
        info,
        onMessage,
        onClose,
    }: {
        url: string,
        info: ClientInfoWithoutId,
        onMessage: OnMessageCallback,
        onClose: () => void,
    }): Promise<SignalingConnection> {
        console.log(`Connecting to ${url}`);

        const encodedInfo = encodeBase64(JSON.stringify(info));
        const socket = await new Promise<WebSocket>((resolve, reject) => {
            const ws = new WebSocket(`${url}?d=${encodedInfo}`);
            ws.onopen = () => resolve(ws);
            ws.onerror = (err) => reject(err);
        });

        console.log('Signaling connection established');

        const instance = new SignalingConnection(socket, onMessage, onClose);
        socket.onmessage = (event) => {
            const message = JSON.parse(event.data) as WsServerMessage;
            instance._onMessage(message);
        }
        socket.onclose = () => {
            console.log('Signaling connection closed');
            instance._onClose();
        }

        return instance;
    }

    public send(message: WsClientMessage) {
        this._socket.send(JSON.stringify(message));
    }

    public onMessage(callback: OnMessageCallback) {
        this._onMessage = callback;
    }

    public onClose(callback: () => void) {
        this._onClose = callback;
    }
}

export type ClientInfoWithoutId = {
    alias: string;
    version: string;
    deviceModel?: string;
    deviceType?: PeerDeviceType;
    fingerprint: string;
}

export type ClientInfo = ClientInfoWithoutId & { id: string };

export enum PeerDeviceType {
    mobile = "mobile",
    desktop = "desktop",
    web = "web",
    headless = "headless",
    server = "server",
}

export type WsServerMessage = HelloMessage | JoinedMessage | LeftMessage | OfferMessage | AnswerMessage | ErrorMessage;

export type HelloMessage = {
    type: "hello";
    client: ClientInfo;
    peers: ClientInfo[];
}

export type JoinedMessage = {
    type: "joined";
    peer: ClientInfo;
}

export type LeftMessage = {
    type: "left";
    peerId: string;
}

export type WsServerSdpMessage = {
    peer: ClientInfo;
    sessionId: string;
    sdp: string;
}

export type OfferMessage = WsServerSdpMessage & { type: "offer" };

export type AnswerMessage = WsServerSdpMessage & { type: "answer" };

export type ErrorMessage = {
    type: "error";
    code: number;
}

type OnMessageCallback = (message: WsServerMessage) => void;

export type WsClientMessage = {
    type: "offer" | "answer";
    sessionId: string;
    target: string;
    sdp: string;
}
