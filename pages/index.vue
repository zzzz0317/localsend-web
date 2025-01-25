<template>
  <div class="dark:text-white flex flex-col h-screen">
    <div class="flex mt-2">
      <img src="/apple-touch-icon.png" alt="Logo" class="h-16 ml-2" style="animation: spin 10s linear infinite;">
      <div class="flex flex-col justify-center ml-2">
        <h1 class="text-xl font-bold">LocalSend</h1>
        <h2 class="leading-none mt-0.5">Web</h2>
      </div>
    </div>

    <div v-if="store.client" class="text-center mt-8 pb-8">
      {{ t('index.you') }}<br>
      <span class="font-bold">{{ store.client.alias }}</span>
    </div>

    <div v-if="!store.signaling" class="flex-1 flex flex-col items-center justify-center text-center px-2">
      <h3 v-if="minDelayFinished" class="text-3xl">{{ t('index.connecting') }}</h3>
    </div>

    <div v-else-if="store.peers.length === 0" class="flex-1 flex flex-col items-center justify-center text-center px-2">
      <h3 class="text-3xl">{{ t('index.empty.title') }}</h3>
      <h3 class="mt-2">{{ t('index.empty.deviceHint') }}</h3>
      <h3>{{ t('index.empty.lanHint') }}</h3>
    </div>

    <div v-else class="flex justify-center px-4">
      <div class="w-96">
        <PeerCard v-for="peer in store.peers" :key="peer.id" :peer="peer" class="mb-4" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  PeerDeviceType,
} from "@/services/signaling";
import {setupConnection, store} from "@/services/store";
import {getAgentInfoString} from "~/utils/userAgent";
import {protocolVersion} from "~/services/webrtc";
import {generateRandomAlias} from "~/utils/alias";

definePageMeta({
  title: "index.seo.title",
  description: "index.seo.description",
});

const {t} = useI18n();

const minDelayFinished = ref(false);

onMounted(async () => {
  setTimeout(() => {
    // to prevent flickering during initial connection
    minDelayFinished.value = true;
  }, 1000);

  const userAgent = navigator.userAgent;

  const info = {
    alias: generateRandomAlias(),
    version: protocolVersion,
    deviceModel: getAgentInfoString(userAgent),
    deviceType: PeerDeviceType.web,
    fingerprint: Math.random().toString(),
  }

  await setupConnection(info);
});
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