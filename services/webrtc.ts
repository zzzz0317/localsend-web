import {
  SignalingConnection,
  type WsServerSdpMessage,
} from "~/services/signaling";
import { decodeBase64, encodeBase64 } from "~/utils/base64";
import { StreamController } from "~/utils/streamController";
import pako from "pako";
import { saveFileFromBytes } from "~/utils/fileSaver";

export const protocolVersion = "2.3";

export const defaultStun = ["stun:stun.l.google.com:19302"];

export async function sendFiles({
  signaling,
  stunServers,
  fileDtoList,
  fileMap,
  targetId,
  onPin,
  onFilesSkip,
  onFileProgress,
}: {
  signaling: SignalingConnection;
  stunServers: string[];
  fileDtoList: FileDto[];
  fileMap: Record<string, File>;
  targetId: string;
  onPin: () => Promise<string | null>;
  onFilesSkip: (fileIds: string[]) => void;
  onFileProgress: (progress: FileProgress) => void;
}) {
  console.log("Sending to target:", targetId);
  console.log("Sending files:", fileDtoList);

  const peerConnection = await createPeerConnection(stunServers);

  const dataChannel = peerConnection.createDataChannel("data");
  dataChannel.binaryType = "arraybuffer";
  const dataChannelStream = createStreamController(dataChannel);
  const dataChannelOpened = new Promise<void>((resolve) => {
    dataChannel.onopen = () => resolve();
  });

  console.log("Creating offer...");

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await waitICEGathering(peerConnection);
  const localSdp = peerConnection.localDescription!.sdp;

  console.log("Local SDP: ", localSdp);

  const sessionId = Math.random().toString(36).substring(2, 15);

  signaling.send({
    type: "offer",
    sessionId: sessionId,
    target: targetId,
    sdp: encodeSdp(localSdp),
  });

  console.log("Waiting for answer...");

  const answer = await signaling.waitForAnswer(sessionId);
  const answerSdp = decodeSdp(answer.sdp);

  console.log("Received answer SDP: ", answerSdp);

  await peerConnection.setRemoteDescription({
    type: "answer",
    sdp: answerSdp,
  });

  await dataChannelOpened;

  console.log("Data channel opened. Waiting for initial status...");

  initLoop: while (true) {
    const statusRaw = await dataChannelStream.readNext();
    if (typeof statusRaw !== "string") {
      throw new Error("Expected string");
    }
    const status = (JSON.parse(statusRaw) as RTCInitResponse).status;

    console.log(`Received status: ${status}`);

    switch (status) {
      case RTCInitStatus.ok:
        break initLoop;
      case RTCInitStatus.pinRequired:
        const pin = await onPin();
        if (!pin) {
          dataChannel.close();
          return;
        }

        dataChannel.send(
          JSON.stringify({
            pin: pin,
          } as RTCPinRequest),
        );
        continue;
      case RTCInitStatus.tooManyRequests:
        console.error("Too many requests");
        return;
    }
  }

  sendStringInChunks(
    dataChannel,
    JSON.stringify({ files: fileDtoList } as RTCFileListRequest),
  );

  sendDelimiter(dataChannel);

  console.log("Sent file list. Waiting for selection...");

  let dataChannelIterator = dataChannelStream.createAsyncIterator();
  let chunks: ArrayBuffer[] = [];
  for await (const chunk of dataChannelIterator.asyncIterator) {
    if (typeof chunk === "string") {
      break;
    }
    chunks.push(chunk);
  }
  dataChannelIterator.releaseLock();

  const fileTokens = (
    JSON.parse(arrayBufferToString(chunks)) as RTCFileListResponse
  ).files;

  console.log(
    `Selected files: ${Object.keys(fileTokens).length} / ${fileDtoList.length}`,
  );

  const skippedFiles: string[] = [];
  fileDtoList = fileDtoList.filter((file) => {
    const hasToken = fileTokens[file.id];
    if (!hasToken) {
      skippedFiles.push(file.id);
    }
    return hasToken;
  });

  if (skippedFiles.length > 0) {
    onFilesSkip(skippedFiles);
  }

  const startTime = Date.now();

  const firstFileDto = fileDtoList[0];
  dataChannel.send(
    JSON.stringify({
      id: firstFileDto.id,
      token: fileTokens[firstFileDto.id],
    } as RTCSendFileHeaderRequest),
  );

  for (let i = 0; i < fileDtoList.length; i++) {
    const fileDto = fileDtoList[i];

    const file = fileMap[fileDto.id];
    const fileSize = file.size;
    console.log(`Sending file: ${fileDto.fileName}`);
    await sendFileInChunks(dataChannel, file, (bytes) => {
      onFileProgress({
        id: fileDto.id,
        curr: bytes,
      });
    });

    if (i + 1 < fileDtoList.length) {
      const nextFileDto = fileDtoList[i + 1];
      const fileToken = fileTokens[nextFileDto.id];

      dataChannel.send(
        JSON.stringify({
          id: nextFileDto.id,
          token: fileToken,
        } as RTCSendFileHeaderRequest),
      );
    } else {
      sendDelimiter(dataChannel);
    }

    console.log("Waiting for file status...");
    const fileStatus = await dataChannelStream.readNext();
    if (typeof fileStatus !== "string") {
      throw new Error("Expected string");
    }

    const response = JSON.parse(fileStatus) as RTCSendFileResponse;
    onFileProgress({
      id: fileDto.id,
      curr: fileSize,
      success: response.success,
      error: response.error,
    });
  }

  const sumSize = fileDtoList.reduce((sum, file) => sum + file.size, 0);

  console.log(
    `Finished in ${Date.now() - startTime} ms. Speed: ${(sumSize * 1000) / (Date.now() - startTime) / (1024 * 1024)} MB/s`,
  );

  dataChannel.close();
  peerConnection.close();

  console.log("Connection closed");
}

export async function receiveFiles({
  signaling,
  stunServers,
  offer,
  pin,
  selectFiles,
  onFileProgress,
}: {
  signaling: SignalingConnection;
  stunServers: string[];
  offer: WsServerSdpMessage;
  pin?: PinConfig;
  selectFiles: (files: FileDto[]) => Promise<string[]>;
  onFileProgress: (progress: FileProgress) => void;
}) {
  console.log("Accepting offer from:", offer.peer.id);
  console.log("Remote SDP: ", decodeSdp(offer.sdp));

  const peerConnection = await createPeerConnection(stunServers);

  const dataChannelPromise = new Promise<RTCDataChannel>((resolve) => {
    peerConnection.ondatachannel = (event) => {
      resolve(event.channel);
    };
  });

  await peerConnection.setRemoteDescription({
    type: "offer",
    sdp: decodeSdp(offer.sdp),
  });

  console.log("Creating answer...");
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  await waitICEGathering(peerConnection);
  const localSdp = peerConnection.localDescription!.sdp;

  console.log("Local SDP: ", localSdp);

  signaling.send({
    type: "answer",
    sessionId: offer.sessionId,
    target: offer.peer.id,
    sdp: encodeSdp(localSdp),
  });

  console.log("Waiting for data channel...");

  const dataChannel = await dataChannelPromise;
  dataChannel.binaryType = "arraybuffer";

  console.log("Received data channel");

  const dataChannelStream = createStreamController(dataChannel);

  await new Promise<void>((resolve) => {
    dataChannel.onopen = () => resolve();
  });

  console.log("Data channel opened.");

  await waitBufferEmpty(dataChannel);

  if (pin) {
    let remotePin = "";
    let pinTry = 0;

    while (true) {
      if (remotePin === pin.pin) {
        break;
      }

      if (pinTry >= pin.maxTries) {
        dataChannel.send(
          JSON.stringify({
            status: RTCInitStatus.tooManyRequests,
          } as RTCInitResponse),
        );

        await waitBufferEmpty(dataChannel);
        return;
      }

      dataChannel.send(
        JSON.stringify({
          status: RTCInitStatus.pinRequired,
        } as RTCInitResponse),
      );

      const remotePinRaw = await dataChannelStream.readNext();
      if (typeof remotePinRaw !== "string") {
        throw new Error("Expected string");
      }
      remotePin = (JSON.parse(remotePinRaw) as RTCPinRequest).pin;
      pinTry++;
    }
  }

  dataChannel.send(
    JSON.stringify({
      status: RTCInitStatus.ok,
    } as RTCInitResponse),
  );

  console.log("Waiting for file list...");

  let dataChannelIterator = dataChannelStream.createAsyncIterator();
  let chunks: ArrayBuffer[] = [];
  for await (const chunk of dataChannelIterator.asyncIterator) {
    if (typeof chunk === "string") {
      break;
    }
    chunks.push(chunk);
  }
  dataChannelIterator.releaseLock();

  const fileList = (
    JSON.parse(arrayBufferToString(chunks)) as RTCFileListRequest
  ).files;

  console.log("Received file list:", fileList);

  const selectedFiles = await selectFiles(fileList);

  const selectedFilesMap: Record<string, FileDto> = {};
  const selectedFilesTokens: Record<string, string> = {};
  for (const file of fileList) {
    if (selectedFiles.includes(file.id)) {
      selectedFilesMap[file.id] = file;
      selectedFilesTokens[file.id] = Math.random().toString();
    }
  }

  console.log(`Selected files: ${selectedFiles.length} / ${fileList.length}`);

  sendStringInChunks(
    dataChannel,
    JSON.stringify({
      files: selectedFilesTokens,
    } as RTCFileListResponse),
  );

  sendDelimiter(dataChannel);

  console.log("Receiving files...");

  dataChannelIterator = dataChannelStream.createAsyncIterator();
  let fileState: { id: string; chunks: ArrayBuffer[]; curr: number } | null =
    null;
  for await (const chunk of dataChannelIterator.asyncIterator) {
    if (typeof chunk === "string") {
      if (fileState) {
        saveFileFromBytes(
          new Blob(fileState.chunks),
          selectedFilesMap[fileState.id].fileName,
        );

        onFileProgress({
          id: fileState.id,
          curr: fileState.curr,
          success: true,
        });

        // Send status of last file
        dataChannel.send(
          JSON.stringify({
            id: fileState.id,
            success: true,
          } as RTCSendFileResponse),
        );

        if (chunk.length <= 1) {
          // End of all files
          // Wait for the last status to be sent
          fileState = null;
          await waitBufferEmpty(dataChannel);
          break;
        }
      }

      const header = JSON.parse(chunk) as RTCSendFileHeaderRequest;
      fileState = {
        id: header.id,
        chunks: [],
        curr: 0,
      };
    } else {
      if (!fileState) {
        throw new Error("Expected file state");
      }
      fileState.chunks.push(chunk);
      fileState.curr += chunk.byteLength;
      onFileProgress({
        id: fileState.id,
        curr: fileState.curr,
      });
    }
  }
  dataChannelIterator.releaseLock();

  dataChannel.close();
  peerConnection.close();
}

async function createPeerConnection(
  stunServers: string[],
): Promise<RTCPeerConnection> {
  const peerConnection = new RTCPeerConnection({
    iceServers:
      stunServers.length === 0
        ? undefined
        : [
            {
              urls: stunServers,
            },
          ],
  });

  peerConnection.onicecandidateerror = (event) => {
    console.error("ICE candidate error:", event);
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log(
      "ICE connection state:",
      peerConnection.iceConnectionState,
      peerConnection
        .getConfiguration()
        .iceServers?.map((server) => server.urls),
    );
  };

  return peerConnection;
}

function createStreamController(dataChannel: RTCDataChannel) {
  const dataChannelStream = new StreamController<string | ArrayBuffer>();
  dataChannel.onmessage = (event) => {
    dataChannelStream.add(event.data);
  };
  return dataChannelStream;
}

export type PinConfig = {
  pin: string;
  maxTries: number;
};

export type FileProgress = {
  id: string;
  curr: number;
  success?: boolean;
  error?: string;
};

export type FileDto = {
  id: string;
  fileName: string;
  size: number;
  fileType: string;
  sha256?: string;
  preview?: string;
  metadata?: FileMetadata;
};

export type FileMetadata = {
  modified?: string;
  accessed?: string;
};

type RTCInitResponse = {
  status: RTCInitStatus;
};

enum RTCInitStatus {
  ok = "ok",
  pinRequired = "pinRequired",
  tooManyRequests = "tooManyRequests",
}

type RTCPinRequest = {
  pin: string;
};

type RTCFileListRequest = {
  files: FileDto[];
};

type RTCFileListResponse = {
  files: Record<string, string>;
};

type RTCSendFileHeaderRequest = {
  id: string;
  token: string;
};

type RTCSendFileResponse = {
  id: string;
  success: boolean;
  error?: string;
};

function encodeSdp(s: string): string {
  const data = new TextEncoder().encode(s);
  const compressed = pako.deflate(data);
  return encodeBase64(compressed);
}

function decodeSdp(s: string): string {
  const compressed = decodeBase64(s);
  const decompressed = pako.inflate(compressed);

  if (!decompressed) {
    throw new Error("Decompression failed.");
  }

  return new TextDecoder().decode(decompressed);
}

function sendDelimiter(dataChannel: RTCDataChannel) {
  dataChannel.send("0");
}

const CHUNK_SIZE = 16 * 1024; // 16 KiB

const MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1 MiB

function sendStringInChunks(dataChannel: RTCDataChannel, str: string) {
  const utf8Binary = new TextEncoder().encode(str);
  for (let i = 0; i < utf8Binary.length; i += CHUNK_SIZE) {
    dataChannel.send(utf8Binary.slice(i, i + CHUNK_SIZE));
  }
}

/**
 * Send a file in chunks.
 * It buffers until CHUNK_SIZE is reached and splits if the buffer too large.
 * @param dataChannel
 * @param file
 * @param onProgress
 */
async function sendFileInChunks(
  dataChannel: RTCDataChannel,
  file: File,
  onProgress: (bytes: number) => void,
) {
  const reader = file.stream().getReader();
  let buffer = new Uint8Array(0);
  let bytesSent = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // No more data from file; send remaining buffer if it has any data.
      if (buffer.length > 0) {
        dataChannel.send(buffer);
      }
      break;
    }

    const newBuffer = new Uint8Array(buffer.length + value.length);
    newBuffer.set(buffer);
    newBuffer.set(value, buffer.length);
    buffer = newBuffer;

    // As long as the buffer is large enough to contain at least one chunk, send chunks.
    while (buffer.length >= CHUNK_SIZE) {
      while (dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const chunkToSend = buffer.slice(0, CHUNK_SIZE);
      dataChannel.send(chunkToSend);

      bytesSent += chunkToSend.length;
      onProgress(bytesSent);

      // Remove the chunk from buffer
      buffer = buffer.slice(CHUNK_SIZE);
    }
  }
}

function arrayBufferToString(arrayBuffers: ArrayBuffer[]): string {
  const totalLength = arrayBuffers.reduce(
    (sum, buffer) => sum + buffer.byteLength,
    0,
  );
  const combinedArray = new Uint8Array(totalLength);
  let offset = 0;
  arrayBuffers.forEach((buffer) => {
    combinedArray.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  });
  return new TextDecoder().decode(combinedArray);
}

async function waitBufferEmpty(dataChannel: RTCDataChannel) {
  while (dataChannel.bufferedAmount > 0) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitICEGathering(localConnection: RTCPeerConnection) {
  if (localConnection.iceGatheringState === "complete") {
    return;
  }

  await new Promise<void>((resolve) => {
    localConnection.onicegatheringstatechange = () => {
      if (localConnection.iceGatheringState === "complete") {
        resolve();
      }
    };
  });
}
