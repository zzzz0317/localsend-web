<template>
  <div class="dark:text-white flex flex-col h-screen">
    <div class="flex mt-2">
      <img src="/apple-touch-icon.png" alt="Logo" class="h-16 ml-2" style="animation: spin 10s linear infinite;">
      <div class="flex flex-col justify-center ml-2">
        <h1 class="text-xl font-bold">LocalSend</h1>
        <h2 class="leading-none mt-0.5">Web</h2>
      </div>
    </div>

    <div v-if="peers.length === 0" class="flex-1 flex flex-col items-center justify-center pt-4 text-center px-2">
      <h3 class="text-3xl">{{ t('index.empty.title') }}</h3>
      <h3 class="mt-2">{{ t('index.empty.deviceHint') }}</h3>
      <h3>{{ t('index.empty.lanHint') }}</h3>
    </div>

    <div v-else class="flex justify-center px-2 mt-12">
      <div class="w-96">
        <PeerCard v-for="peer in peers" :key="peer.id" :peer="peer" class="mb-4" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  type AnswerMessage,
  type ClientInfo, getSignalingConnection,
  type HelloMessage,
  type JoinedMessage,
  type LeftMessage,
  type OfferMessage,
  PeerDeviceType, setSignalingConnection,
  SignalingConnection, type WsServerMessage
} from "@/services/signaling";

definePageMeta({
  title: "index.seo.title",
  description: "index.seo.description",
});

const {t} = useI18n();

const signaling = ref<SignalingConnection | null>(null);
const peers = ref<ClientInfo[]>([]);

onMounted(async () => {
  const info = {
    alias: "Cute Orange",
    version: "2.3",
    deviceModel: "Samsung",
    deviceType: PeerDeviceType.mobile,
    fingerprint: "123456",
  }

  const existingConnection = getSignalingConnection();

  const onMessage = (data: WsServerMessage) => {
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
  };

  if (existingConnection) {
    existingConnection.onMessage(onMessage);
    signaling.value = existingConnection;
  } else {
    const newConnection = await SignalingConnection.connect({
      url: "wss://public.localsend.org/v1/ws",
      info,
      onMessage: onMessage,
      onClose: () => setSignalingConnection(null),
    });
    setSignalingConnection(newConnection);
    signaling.value = newConnection;
  }
});

const onHello = (m: HelloMessage) => {
  peers.value = m.peers;
};

const onJoined = (m: JoinedMessage) => {
  peers.value = [...peers.value, m.peer];
};

const onLeft = (m: LeftMessage) => {
  peers.value = peers.value.filter((p) => p.id !== m.peerId);
};

const onOffer = (m: OfferMessage) => {
  console.log("Received offer", m);
}

const onAnswer = (m: AnswerMessage) => {
  console.log("Received answer", m);
}

</script>

<style>
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>