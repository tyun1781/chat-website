<script setup lang="ts">
import { user } from '../api'
defineEmits<{ login: []; register: []; nickname: []; password: []; forum: [] }>()
const dateText = (value: string) => new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
</script>
<template>
  <section class="account-home" aria-labelledby="home-title">
    <div class="page-heading"><p lang="ja">おかえりなさい (´▽`)</p><h1 id="home-title">我的主页</h1><span>你的注册信息与账号设置</span></div>
    <div v-if="user" class="account-overview"><div class="profile-intro"><span class="profile-avatar" aria-hidden="true">{{ Array.from(user.nickname)[0] }}</span><div><h2>{{ user.nickname }}</h2><p>很高兴在这里遇见你。</p></div></div><dl class="registration-details"><div><dt>用户名</dt><dd>{{ user.username }}</dd></div><div><dt>公开昵称</dt><dd>{{ user.nickname }}</dd></div><div><dt>注册时间</dt><dd>{{ dateText(user.createdAt) }}</dd></div><div><dt>账号类型</dt><dd>{{ user.role === 'admin' ? '管理员' : '普通用户' }}</dd></div><div><dt>账号状态</dt><dd>{{ user.status === 'active' ? '正常' : '已停用' }}</dd></div></dl><div class="profile-actions"><button class="small-button" @click="$emit('nickname')">修改昵称</button><button class="profile-secondary" @click="$emit('password')">修改密码</button><button class="text-link" @click="$emit('forum')">返回讨论广场</button></div><p class="account-privacy">注册信息仅向你展示。密码不会在页面显示。</p></div>
    <div v-else class="account-overview guest-home"><span class="guest-symbol" aria-hidden="true">⌂</span><h2>登录后，打开你的主页。</h2><p>查看注册信息，修改昵称和密码。</p><div class="profile-actions"><button class="small-button" @click="$emit('login')">登录</button><button class="profile-secondary" @click="$emit('register')">注册账号</button></div></div>
  </section>
</template>
