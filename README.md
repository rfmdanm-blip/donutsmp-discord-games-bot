# DonutSMP Discord Games Bot

A Discord bot for a DonutSMP community using **virtual credits only**.

## Included
- `/balance`
- `/daily`
- `/transfer`
- `/leaderboard`
- `/games`
- `/coinflip`
- `/slots`
- `/dice`
- `/roulette`
- `/blackjack`
- `/history`
- `/admin addbalance`
- `/admin removebalance`
- `/admin setbalance`
- `/admin stats`

All balances are stored in SQLite. Game results and balance changes are logged.

## Setup

1. Install Node.js 20 or newer.
2. Create a Discord application at the Discord Developer Portal.
3. Create a bot and copy its token.
4. Copy `.env.example` to `.env`.
5. Fill in:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `GUILD_ID`
   - `ADMIN_ROLE_ID`
   - optionally `LOG_CHANNEL_ID`
6. Run:
   ```bash
   npm install
   npm start
   ```

The bot registers its commands to the server specified by `GUILD_ID`.

## Discord permissions

The bot needs:
- View Channels
- Send Messages
- Embed Links
- Read Message History

Give the bot the appropriate permissions for your server.

## Notes

This project intentionally uses **virtual, non-withdrawable credits**. It does not connect to payment services, crypto wallets, DonutSMP currency transfers, or cash-out systems.
