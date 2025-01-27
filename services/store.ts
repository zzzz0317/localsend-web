import type {
  ClientInfo,
  ClientInfoWithoutId,
  WsServerMessage,
} from "~/services/signaling";
import { SignalingConnection } from "~/services/signaling";
import {type FileDto, sendFiles} from "~/services/webrtc";

export enum SessionState {
  idle = "idle",
  sending = "sending",
  receiving = "receiving",
}

export type FileState = {
  id: string;
  name: string;
  curr: number;
  total: number;
  state: "pending" | "skipped" | "sending" | "finished" | "error";
  error?: string;
}

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

  // Current session information
  session: {
    state: SessionState.idle,
    curr: 0,
    total: 1, // Avoid division by zero
    fileState: {} as Record<string, FileState>,
  },
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
              store.client = data.client;
              store.peers = data.peers;
              break;
            case "joined":
              store.peers = [...store.peers, data.peer];
              break;
            case "left":
              store.peers = store.peers.filter((p) => p.id !== data.peerId);
              break;
            case "offer":
              break;
            case "answer":
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

export async function startSendSession({
  files,
  targetId,
}: {
  files: FileList;
  targetId: string;
}): Promise<void> {
  store.session.state = SessionState.sending;
  const fileState: Record<string, FileState> = {};

  const fileDtoList = convertFileListToDto(files);
  const fileMap = fileDtoList.reduce(
      (acc, file) => {
        acc[file.id] = files[parseInt(file.id)];
        fileState[file.id] = {
          id: file.id,
          name: file.fileName,
          curr: 0,
          total: file.size,
          state: "pending",
        };
        return acc;
      },
      {} as Record<string, File>,
  );

  store.session.fileState = fileState;
  store.session.curr = 0;
  store.session.total = fileDtoList.reduce((acc, file) => acc + file.size, 0);

  try {
    await sendFiles({
      signaling: store.signaling as SignalingConnection,
      stunServers: [],
      fileDtoList: fileDtoList,
      fileMap: fileMap,
      targetId: targetId,
      onFilesSkip: (fileIds) => {
        for (const id of fileIds) {
          store.session.fileState[id].state = "skipped";
        }
      },
      onFileProgress: (progress) => {
        store.session.fileState[progress.id].curr = progress.curr;
        store.session.curr = Object.values(store.session.fileState).reduce(
            (acc, file) => acc + file.curr,
            0,
        );
        if (progress.success) {
          store.session.fileState[progress.id].state = "finished";
        } else if (progress.error) {
          store.session.fileState[progress.id].state = "error";
          store.session.fileState[progress.id].error = progress.error;
        }
      },
    });
  } finally {
    // store.session.state = SessionState.idle;
  }
}

function convertFileListToDto(files: FileList): FileDto[] {
  const result: FileDto[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    result.push({
      id: i.toString(),
      fileName: file.name,
      size: file.size,
      fileType: file.type,
      metadata: {
        modified: new Date(file.lastModified).toISOString(),
      },
    });
  }

  return result;
}
