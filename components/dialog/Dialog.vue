<template>
  <transition name="fade">
    <div
        v-if="props.visible"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
    >
      <div
          class="bg-white w-full max-w-lg mx-4 rounded shadow-md text-black"
          role="dialog"
          aria-modal="true"
      >
        <slot />
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
const props = defineProps<{
  visible: boolean;
}>();
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease-in-out;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
