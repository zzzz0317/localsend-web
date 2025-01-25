import type {ClientInfo, SignalingConnection} from "~/services/signaling";

export const store = reactive({
    // Signaling connection to the server
    signaling: null as SignalingConnection | null,

    // Client information of the current user
    client: null as ClientInfo | null,

    // List of peers connected to the same room
    peers: [] as ClientInfo[],
});
