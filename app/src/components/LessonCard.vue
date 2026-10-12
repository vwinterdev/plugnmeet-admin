<script setup>
import { ref } from 'vue';
import { addStudent, deleteLesson, deleteStudent, copyText } from '../api';

const props = defineProps({ lesson: { type: Object, required: true } });
const emit = defineEmits(['changed', 'toast']);

const name = ref('');

async function copy(link) {
  await copyText(link);
  emit('toast', 'Ссылка скопирована');
}

async function run(action) {
  try {
    await action();
  } catch (e) {
    emit('toast', e.message);
  }
}

const onAdd = () => run(async () => {
  const updated = await addStudent(props.lesson.id, name.value);
  name.value = '';
  await copy(updated.students[updated.students.length - 1].link);
  emit('changed');
});

const onRemoveStudent = (student) => run(async () => {
  await deleteStudent(props.lesson.id, student.id);
  emit('changed');
});

const onRemoveLesson = () => run(async () => {
  if (!confirm(`Удалить урок «${props.lesson.title}»?`)) return;
  await deleteLesson(props.lesson.id);
  emit('changed');
});
</script>

<template>
  <section class="card">
    <div class="row between">
      <h2>{{ lesson.title }}</h2>
      <div class="row">
        <a :href="`/enter/${lesson.id}`" target="_blank"><button type="button">Начать урок</button></a>
        <button class="ghost danger" type="button" @click="onRemoveLesson">Удалить</button>
      </div>
    </div>

    <ul>
      <li v-for="student in lesson.students" :key="student.id">
        <span class="name">{{ student.name }}</span>
        <button class="ghost" type="button" @click="copy(student.link)">Копировать ссылку</button>
        <button class="ghost danger" type="button" title="Удалить" @click="onRemoveStudent(student)">×</button>
      </li>
      <li v-if="!lesson.students.length" class="muted">Учеников пока нет</li>
    </ul>

    <form class="row add" @submit.prevent="onAdd">
      <input v-model="name" placeholder="Имя ученика" maxlength="60" required>
      <button class="plus" title="Добавить ученика">+</button>
    </form>
  </section>
</template>
