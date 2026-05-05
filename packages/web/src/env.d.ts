/// <reference types="astro/client" />

interface User {
  discordUserId: string;
  guildId: string;
  isAdmin: boolean;
}

declare namespace App {
  interface Locals {
    user: User | null;
    isAuthenticated: boolean;
  }
}
