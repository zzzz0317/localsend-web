import { encodeBase64 } from "~/utils/base64";

export class SignalingConnection {
    private _socket: WebSocket;

    private constructor(socket: WebSocket) {
        this._socket = socket;
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
            ws.onmessage = (event) => {
                const message = JSON.parse(event.data) as WsServerMessage;
                onMessage(message);
            };
        });

        // ping every 120 seconds to keep the connection alive
        const pingInterval = setInterval(() => {
            socket.send('');
        }, 120 * 1000);

        socket.onclose = () => {
            console.log('Signaling connection closed');
            clearInterval(pingInterval);
            onClose();
        }

        console.log('Signaling connection established');

        return new SignalingConnection(socket);
    }

    public send(message: WsClientMessage) {
        this._socket.send(JSON.stringify(message));
    }

    public async waitUntilClose(): Promise<void> {
        return new Promise((resolve) => {
            this._socket.addEventListener('close', () => {
                resolve();
            });
        });
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
