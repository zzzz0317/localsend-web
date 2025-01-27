import type {
  AnswerMessage,
  ClientInfo,
  ClientInfoWithoutId,
  HelloMessage,
  JoinedMessage,
  LeftMessage,
  OfferMessage,
  WsServerMessage,
} from "~/services/signaling";
import { SignalingConnection } from "~/services/signaling";

export const store = reactive({
  // Whether the connection loop has started
  _loopStarted: false,

  // Client information of the current user that we send to the server
  _proposingClient: null as ClientInfoWithoutId | null,

  // Signaling connection to the server
  signaling: null as SignalingConnection | null,

  // Client information of the current user that we received from the server
  client: null as ClientInfo | null,

  // List of peers connected to the same room
  peers: [] as ClientInfo[],
});

export async function setupConnection(info: ClientInfoWithoutId) {
  store._proposingClient = info;
  if (!store._loopStarted) {
    store._loopStarted = true;
    connectionLoop().then(() => console.log("Connection loop ended"));
  }
}

async function connectionLoop() {
  while (true) {
    try {
      store.signaling = await SignalingConnection.connect({
        url: "wss://public.localsend.org/v1/ws",
        info: store._proposingClient!,
        onMessage: (data: WsServerMessage) => {
          console.log(`Received message: ${JSON.stringify(data)}`);
          switch (data.type) {
            case "hello":
              onHello(data);
              break;
            case "joined":
              onJoined(data);
              break;
            case "left":
              onLeft(data);
              break;
            case "offer":
              onOffer(data);
              break;
            case "answer":
              onAnswer(data);
              break;
          }
        },
        onClose: () => {
          store.signaling = null;
          store.client = null;
          store.peers = [];
        },
      });

      await store.signaling.waitUntilClose();
    } catch (error) {
      console.log("Retrying connection in 5 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait before retrying
    }
  }
}

const onHello = (m: HelloMessage) => {
  store.client = m.client;
  store.peers = m.peers;
};

const onJoined = (m: JoinedMessage) => {
  store.peers = [...store.peers, m.peer];
};

const onLeft = (m: LeftMessage) => {
  store.peers = store.peers.filter((p) => p.id !== m.peerId);
};

const onOffer = (m: OfferMessage) => {
  console.log("Received offer", m);
};

const onAnswer = (_: AnswerMessage) => {};
