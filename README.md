# GRKD-Jisho

Discord dictionary bot for Indonesian learners of Japanese.

## Overview
GRKD-Jisho is a Discord bot that provides Japanese dictionary definitions tailored for Indonesian speakers. It uses a Yomitan dictionary database as the source of truth, an LLM to explain the definitions based on user roles, and a local database to cache and manage responses.

## Current Status
**Version:** v0.1.1 (Pre-Release)
**Status:** Active Development (Phase 4 / Pre-Release)

*Note: The project is currently in a pre-release state. MCP (Model Context Protocol) testing is explicitly deferred and is not a blocking requirement for this release.*

## Architecture
- **Bot:** Node.js 20 LTS + TypeScript + discord.js v14
- **Database:** PostgreSQL 16 + Drizzle ORM
- **Web UI:** Astro + React islands (Admin interface)
- **AI/LLM:** Gemini primary / OpenRouter fallback
- **Agent Control Plane:** MCP Server (Testing currently deferred)
- **Monorepo Management:** pnpm workspaces

## Project Structure
- packages/bot/: Discord events, commands, and bot services.
- packages/db/: Drizzle schema, DB client, migrations, and import scripts.
- packages/web/: Admin Web UI for response management.
- packages/mcp/: Control plane for AI agent operations (testing deferred).

## Getting Started
See the operations and implementation plans in DOCS/ for deployment and setup instructions.

