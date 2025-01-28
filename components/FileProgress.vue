<template>
  <div>
    <div class="flex">
      <span class="flex-1 truncate">{{ props.state.name }}</span>
      <span>{{ totalBytesFormatted }}</span>
    </div>

    <ProgressBar :progress="props.state.curr / props.state.total" />
  </div>
</template>

<script setup lang="ts">
import { formatBytes } from "~/utils/fileSize";
import type { FileState } from "~/services/store";

const props = defineProps<{
  state: FileState;
}>();

const totalBytesFormatted = computed(() => {
  return formatBytes(props.state.total);
});
</script>
