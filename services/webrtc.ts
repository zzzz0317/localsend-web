import { SignalingConnection } from "~/services/signaling";
import { decodeBase64, encodeBase64 } from "~/utils/base64";
import { StreamController } from "~/utils/streamController";
import pako from "pako";

export const protocolVersion = "2.3";

export class SendingHandler {
  private _localConnection: RTCPeerConnection;

  private constructor(localConnection: RTCPeerConnection) {
    this._localConnection = localConnection;
  }

  public static async sendFiles({
    signaling,
    stunServers,
    files,
    targetId,
  }: {
    signaling: SignalingConnection;
    stunServers: string[];
    files: FileList;
    targetId: string;
  }): Promise<SendingHandler> {
    const fileDtoList = convertFileListToDto(files);
    const fileMap = fileDtoList.reduce(
      (acc, file) => {
        acc[file.id] = files[parseInt(file.id)];
        return acc;
      },
      {} as Record<string, File>,
    );
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

    // wait 1 sec
    // TODO: Is this necessary?
    await new Promise((resolve) => setTimeout(resolve, 1000));

    sendStringInChunks(dataChannel, JSON.stringify({ files: fileDtoList }));

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

    console.log("Selected files:", fileTokens);

    return new SendingHandler(localConnection);
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

type RTCSendFileHeaderMessage = {
  id: string;
  token: string;
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

function sendStringInChunks(dataChannel: RTCDataChannel, str: string) {
  const utf8Binary = new TextEncoder().encode(str);
  for (let i = 0; i < utf8Binary.length; i += CHUNK_SIZE) {
    dataChannel.send(utf8Binary.slice(i, i + CHUNK_SIZE));
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
