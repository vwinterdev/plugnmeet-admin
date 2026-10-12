<script setup>
import { ref, onMounted } from 'vue';
import LessonCard from './components/LessonCard.vue';
import { listLessons, createLesson } from './api';

const lessons = ref([]);
const title = ref('');
const toastText = ref('');
const toastVisible = ref(false);
let toastTimer;

function toast(text) {
  toastText.value = text;
  toastVisible.value = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastVisible.value = false), 1600);
}

async function load() {
  try {
    lessons.value = await listLessons();
  } catch (e) {
    toast(e.message);
  }
}

async function onCreate() {
  try {
    await createLesson(title.value);
    title.value = '';
    await load();
  } catch (e) {
    toast(e.message);
  }
}

onMounted(load);
</script>

<template>
  <main>
    <h1>Уроки</h1>

    <form class="card row" @submit.prevent="onCreate">
      <input v-model="title" placeholder="Название урока, например «Математика 7Б»" maxlength="100" required>
      <button>Создать урок</button>
    </form>

    <LessonCard
      v-for="lesson in lessons"
      :key="lesson.id"
      :lesson="lesson"
      @changed="load"
      @toast="toast"
    />
    <p v-if="!lessons.length" class="muted">Создайте первый урок.</p>
  </main>

  <div class="toast" :class="{ show: toastVisible }">{{ toastText }}</div>
</template>
