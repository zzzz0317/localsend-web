import type {ClientInfo, SignalingConnection} from "~/services/signaling";

export const store = reactive({
    signaling: null as SignalingConnection | null,
    peers: [] as ClientInfo[],
});
