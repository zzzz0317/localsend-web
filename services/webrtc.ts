import { SignalingConnection } from "~/services/signaling";

export const protocolVersion = "2.3";

export class SendingHandler {
  private _localConnection: RTCPeerConnection;
  private _remoteConnection: RTCPeerConnection;
  private _dataChannel: RTCDataChannel | null = null;

  private constructor(
    localConnection: RTCPeerConnection,
    remoteConnection: RTCPeerConnection,
  ) {
    this._localConnection = localConnection;
    this._remoteConnection = remoteConnection;
  }

  public static async sendFiles({
    signaling,
    stunServers,
    files,
    targetId,
  }: {
    signaling: SignalingConnection;
    stunServers: RTCIceServer[];
    files: FileList;
    targetId: string;
  }) {
    const fileDtoList = convertFileListToDto(files);
    console.log("Sending to target:", targetId);
    console.log("Sending files:", fileDtoList);
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
