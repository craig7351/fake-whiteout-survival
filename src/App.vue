<template>
  <landing-screen v-if="screen === 'landing'" @start="screen = 'game'" />
  <game-view v-else />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import LandingScreen from './components/landing-screen.vue';
import GameView from './components/game-view.vue';

const screen = ref<'landing' | 'game'>('landing');
</script>
