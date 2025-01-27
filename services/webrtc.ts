import { SignalingConnection } from "~/services/signaling";
import { decodeBase64, encodeBase64 } from "~/utils/base64";
import { StreamController } from "~/utils/streamController";
import pako from "pako";

export const protocolVersion = "2.3";

export async function sendFiles({
  signaling,
  stunServers,
  fileDtoList,
  fileMap,
  targetId,
  onFilesSkip,
  onFileProgress,
}: {
  signaling: SignalingConnection;
  stunServers: string[];
  fileDtoList: FileDto[];
  fileMap: Record<string, File>;
  targetId: string;
  onFilesSkip: (fileIds: string[]) => void;
  onFileProgress: (progress: FileProgress) => void;
}) {
  console.log("Sending to target:", targetId);
  console.log("Sending files:", fileDtoList);

  const localConnection = new RTCPeerConnection({
    iceServers:
      stunServers.length === 0
        ? undefined
        : [
            {
              urls: stunServers,
            },
          ],
  });

  console.log("Waiting for ICE connection state to be completed");

  if (stunServers.length !== 0) {
    await new Promise<void>((resolve) => {
      localConnection.onicegatheringstatechange = () => {
        if (localConnection.iceGatheringState === "complete") {
          resolve();
        }
      };
    });
  }

  console.log(
    "ICE connection state is completed:",
    localConnection.iceGatheringState,
  );

  const dataChannel = localConnection.createDataChannel("data");
  dataChannel.binaryType = "arraybuffer";
  const dataChannelStream = new StreamController<string | ArrayBuffer>();
  dataChannel.onmessage = (event) => {
    dataChannelStream.add(event.data);
  };
  const dataChannelOpened = new Promise<void>((resolve) => {
    dataChannel.onopen = () => resolve();
  });

  console.log("Creating offer...");

  const offer = await localConnection.createOffer();
  await localConnection.setLocalDescription(offer);

  console.log("Offer created: ", offer.sdp);

  const sessionId = Math.random().toString(36).substring(2, 15);

  signaling.send({
    type: "offer",
    sessionId: sessionId,
    target: targetId,
    sdp: encodeSdp(offer.sdp!),
  });

  console.log("Waiting for answer...");

  const answer = await signaling.waitForAnswer(sessionId);
  const answerSdp = decodeSdp(answer.sdp);

  console.log("Received answer SDP: ", answerSdp);

  await localConnection.setRemoteDescription({
    type: "answer",
    sdp: answerSdp,
  });

  await dataChannelOpened;

  console.log("Data channel opened");

  await waitBufferEmpty(dataChannel);

  sendStringInChunks(
    dataChannel,
    JSON.stringify({ files: fileDtoList } as RTCInitialMessage),
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
    JSON.parse(arrayBufferToString(chunks)) as RTCInitialResponse
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
  localConnection.close();

  console.log("Connection closed");
}

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

type RTCInitialMessage = {
  files: FileDto[];
};

type RTCInitialResponse = {
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
