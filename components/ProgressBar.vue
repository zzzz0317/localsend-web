<template>
  <div class="w-full h-2 bg-gray-200 rounded-lg mt-1">
    <div
      class="h-full bg-teal-500 rounded-lg"
      :style="{ width: `${props.progress * 100}%` }"
    ></div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  progress: number;
}>();
</script>
