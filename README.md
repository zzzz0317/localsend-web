# LocalSend Web App

A web app integrating WebRTC and WebSockets to share files with other LocalSend peers (browsers, or native versions).

Live: https://web.localsend.org

## Setup

Make sure to install [pnpm](https://pnpm.io).

```bash
npm install -g pnpm
```

Get dependencies

```bash
pnpm install
```

Start the development server

```bash
pnpm run dev
```

## Deployment

Generates the static website in the `dist` directory.

```bash
pnpm run generate
```

## Contributing

### Adding a new language

1. Add new JSON file in `i18n/locales/` directory.
2. Add the new language in `nuxt.config.ts`.
