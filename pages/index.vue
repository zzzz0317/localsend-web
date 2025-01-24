<template>
  <div class="dark:text-white">
    {{ t('hello') }}
    <br>
    Locale: {{ locale }}
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  title: "index.seo.title",
  description: "index.seo.description",
});

const { t, locale } = useI18n();
</script>
