import { createRouter, createWebHistory } from 'vue-router'
// import DefaultLayout from '@/layouts/DefaultLayout.vue'
import MainLayout from '@/layouts/MainLayout.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: MainLayout,
      children: [
        { path: '', component: () => import('@/pages/HomeView.vue') },
        { path: 'prices', component: () => import('@/pages/PricesView.vue') },
        { path: 'epicentr-royalty', component: () => import('@/pages/EpicentrRoyaltyView.vue') },
      ],
    },
  ],
})

export default router
