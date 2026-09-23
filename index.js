require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require("discord.js");
const Database = require("better-sqlite3");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || "";
const STARTING_BALANCE = Number(process.env.STARTING_BALANCE || 1000);
const DAILY_AMOUNT = Number(process.env.DAILY_AMOUNT || 250);

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing DISCORD_TOKEN, CLIENT_ID or GUILD_ID in .env");
  process.exit(1);
}

const db = new Database("data.sqlite");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  daily_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  game TEXT NOT NULL,
  bet INTEGER NOT NULL,
  result TEXT NOT NULL,
  payout INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function ensureUser(user) {
  const existing = db.prepare("SELECT * FROM users WHERE user_id = ?").get(user.id);
  if (existing) {
    db.prepare("UPDATE users SET username = ? WHERE user_id = ?").run(user.username, user.id);
    return existing;
  }

  const now = Date.now();
  db.prepare(
    "INSERT INTO users (user_id, username, balance, created_at) VALUES (?, ?, ?, ?)"
  ).run(user.id, user.username, STARTING_BALANCE, now);

  addTransaction(user.id, "starting_balance", STARTING_BALANCE, STARTING_BALANCE, "Starting balance");
  return db.prepare("SELECT * FROM users WHERE user_id = ?").get(user.id);
}

function getUser(id) {
  return db.prepare("SELECT * FROM users WHERE user_id = ?").get(id);
}

function changeBalance(id, delta, type, note) {
  const user = getUser(id);
  if (!user) throw new Error("User not found.");
  const next = user.balance + delta;
  if (next < 0) throw new Error("Insufficient balance.");

  db.prepare("UPDATE users SET balance = ? WHERE user_id = ?").run(next, id);
  addTransaction(id, type, delta, next, note);
  return next;
}

function addTransaction(userId, type, amount, balanceAfter, note) {
  db.prepare(`
    INSERT INTO transactions
    (user_id, type, amount, balance_after, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, type, amount, balanceAfter, note || "", Date.now());
}

function recordGame(userId, game, bet, result, payout) {
  db.prepare(`
    INSERT INTO games
    (user_id, game, bet, result, payout, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, game, bet, result, payout, Date.now());
}

function validBet(interaction, bet) {
  if (!Number.isInteger(bet) || bet <= 0 || bet > 1000000) {
    interaction.reply({ content: "Your bet must be a whole number between 1 and 1,000,000.", ephemeral: true });
    return false;
  }
  const user = getUser(interaction.user.id);
  if (!user || user.balance < bet) {
    interaction.reply({ content: "You don't have enough virtual credits for that bet.", ephemeral: true });
    return false;
  }
  return true;
}

function admin(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  return ADMIN_ROLE_ID && interaction.member.roles?.cache?.has(ADMIN_ROLE_ID);
}

async function log(interaction, message) {
  if (!LOG_CHANNEL_ID) return;
  const channel = await interaction.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (channel?.isTextBased()) {
    channel.send({ content: message }).catch(() => {});
  }
}

const commands = [
  new SlashCommandBuilder().setName("balance").setDescription("View your virtual-credit balance."),
  new SlashCommandBuilder().setName("daily").setDescription("Claim your daily virtual credits."),
  new SlashCommandBuilder().setName("games").setDescription("View the available games."),
  new SlashCommandBuilder()
    .setName("coinflip").setDescription("Bet virtual credits on heads or tails.")
    .addIntegerOption(o => o.setName("bet").setDescription("Amount to bet").setRequired(true))
    .addStringOption(o => o.setName("pick").setDescription("Heads or tails").setRequired(true)
      .addChoices({name:"Heads",value:"heads"},{name:"Tails",value:"tails"})),
  new SlashCommandBuilder()
    .setName("slots").setDescription("Play the virtual-credit slot machine.")
    .addIntegerOption(o => o.setName("bet").setDescription("Amount to bet").setRequired(true)),
  new SlashCommandBuilder()
    .setName("dice").setDescription("Guess a number from 1 to 6.")
    .addIntegerOption(o => o.setName("bet").setDescription("Amount to bet").setRequired(true))
    .addIntegerOption(o => o.setName("guess").setDescription("Your guess, 1-6").setRequired(true).setMinValue(1).setMaxValue(6)),
  new SlashCommandBuilder()
    .setName("roulette").setDescription("Bet on red, black or green.")
    .addIntegerOption(o => o.setName("bet").setDescription("Amount to bet").setRequired(true))
    .addStringOption(o => o.setName("pick").setDescription("Colour").setRequired(true)
      .addChoices({name:"Red",value:"red"},{name:"Black",value:"black"},{name:"Green",value:"green"})),
  new SlashCommandBuilder()
    .setName("blackjack").setDescription("Play a simple virtual-credit blackjack round.")
    .addIntegerOption(o => o.setName("bet").setDescription("Amount to bet").setRequired(true)),
  new SlashCommandBuilder()
    .setName("transfer").setDescription("Transfer virtual credits to another member.")
    .addUserOption(o => o.setName("user").setDescription("Recipient").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName("leaderboard").setDescription("View the virtual-credit leaderboard."),
  new SlashCommandBuilder().setName("history").setDescription("View your recent games."),
  new SlashCommandBuilder()
    .setName("admin").setDescription("Administrator virtual-credit controls.")
    .addSubcommand(s => s.setName("addbalance").setDescription("Add virtual credits.")
      .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1)))
    .addSubcommand(s => s.setName("removebalance").setDescription("Remove virtual credits.")
      .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1)))
    .addSubcommand(s => s.setName("setbalance").setDescription("Set a member's balance.")
      .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("New balance").setRequired(true).setMinValue(0)))
    .addSubcommand(s => s.setName("stats").setDescription("View bot economy statistics."))
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("Slash commands registered.");
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    ensureUser(interaction.user);
    const name = interaction.commandName;

    if (name === "balance") {
      const u = getUser(interaction.user.id);
      return interaction.reply(`💰 **${u.balance.toLocaleString()}** virtual credits`);
    }

    if (name === "daily") {
      const u = getUser(interaction.user.id);
      const cooldown = 24 * 60 * 60 * 1000;
      if (Date.now() - u.daily_at < cooldown) {
        const remaining = cooldown - (Date.now() - u.daily_at);
        const hours = Math.ceil(remaining / 3600000);
        return interaction.reply({content:`⏳ You can claim your daily reward again in about **${hours}h**.`, ephemeral:true});
      }
      const balance = changeBalance(interaction.user.id, DAILY_AMOUNT, "daily", "Daily reward");
      db.prepare("UPDATE users SET daily_at = ? WHERE user_id = ?").run(Date.now(), interaction.user.id);
      return interaction.reply(`🎁 You received **${DAILY_AMOUNT.toLocaleString()}** credits. Balance: **${balance.toLocaleString()}**`);
    }

    if (name === "games") {
      return interaction.reply(
        "🎮 **Available games**\n" +
        "`/coinflip` — 2x on a correct pick\n" +
        "`/slots` — slot-machine payouts\n" +
        "`/dice` — 6x on the exact number\n" +
        "`/roulette` — red/black/green\n" +
        "`/blackjack` — simple blackjack round"
      );
    }

    if (name === "coinflip") {
      const bet = interaction.options.getInteger("bet");
      const pick = interaction.options.getString("pick");
      if (!validBet(interaction, bet)) return;
      changeBalance(interaction.user.id, -bet, "bet", "Coinflip bet");
      const result = Math.random() < 0.5 ? "heads" : "tails";
      const won = result === pick;
      const payout = won ? bet * 2 : 0;
      if (payout) changeBalance(interaction.user.id, payout, "payout", "Coinflip win");
      recordGame(interaction.user.id, "coinflip", bet, `${pick}/${result}`, payout);
      const u = getUser(interaction.user.id);
      await log(interaction, `Coinflip: ${interaction.user.tag} bet ${bet}, result ${result}, payout ${payout}`);
      return interaction.reply(`🪙 It landed on **${result}**. ${won ? `🎉 You won **${payout.toLocaleString()}**!` : "❌ You lost your bet."}\nBalance: **${u.balance.toLocaleString()}**`);
    }

    if (name === "slots") {
      const bet = interaction.options.getInteger("bet");
      if (!validBet(interaction, bet)) return;
      changeBalance(interaction.user.id, -bet, "bet", "Slots bet");
      const symbols = ["🍒","🍋","🔔","⭐","💎"];
      const spin = [0,1,2].map(() => symbols[Math.floor(Math.random()*symbols.length)]);
      let multiplier = 0;
      if (spin[0] === spin[1] && spin[1] === spin[2]) multiplier = spin[0] === "💎" ? 10 : 5;
      else if (spin[0] === spin[1] || spin[1] === spin[2] || spin[0] === spin[2]) multiplier = 2;
      const payout = bet * multiplier;
      if (payout) changeBalance(interaction.user.id, payout, "payout", "Slots win");
      recordGame(interaction.user.id, "slots", bet, spin.join(" "), payout);
      const u = getUser(interaction.user.id);
      return interaction.reply(`🎰 **${spin.join(" | ")}**\n${payout ? `🎉 Payout: **${payout.toLocaleString()}**` : "❌ No payout this spin."}\nBalance: **${u.balance.toLocaleString()}**`);
    }

    if (name === "dice") {
      const bet = interaction.options.getInteger("bet");
      const guess = interaction.options.getInteger("guess");
      if (!validBet(interaction, bet)) return;
      changeBalance(interaction.user.id, -bet, "bet", "Dice bet");
      const roll = Math.floor(Math.random()*6)+1;
      const payout = roll === guess ? bet * 6 : 0;
      if (payout) changeBalance(interaction.user.id, payout, "payout", "Dice win");
      recordGame(interaction.user.id, "dice", bet, `${guess}/${roll}`, payout);
      const u = getUser(interaction.user.id);
      return interaction.reply(`🎲 Rolled **${roll}**. ${payout ? `🎉 You won **${payout.toLocaleString()}**!` : "❌ You lost your bet."}\nBalance: **${u.balance.toLocaleString()}**`);
    }

    if (name === "roulette") {
      const bet = interaction.options.getInteger("bet");
      const pick = interaction.options.getString("pick");
      if (!validBet(interaction, bet)) return;
      changeBalance(interaction.user.id, -bet, "bet", "Roulette bet");
      const r = Math.random();
      const result = r < 0.475 ? "red" : r < 0.95 ? "black" : "green";
      const payout = result === pick ? bet * (result === "green" ? 14 : 2) : 0;
      if (payout) changeBalance(interaction.user.id, payout, "payout", "Roulette win");
      recordGame(interaction.user.id, "roulette", bet, `${pick}/${result}`, payout);
      const u = getUser(interaction.user.id);
      return interaction.reply(`🎡 Result: **${result}**. ${payout ? `🎉 Payout: **${payout.toLocaleString()}**` : "❌ No payout."}\nBalance: **${u.balance.toLocaleString()}**`);
    }

    if (name === "blackjack") {
      const bet = interaction.options.getInteger("bet");
      if (!validBet(interaction, bet)) return;
      changeBalance(interaction.user.id, -bet, "bet", "Blackjack bet");
      const player = Math.floor(Math.random()*8)+13;
      const dealer = Math.floor(Math.random()*8)+13;
      let payout = 0;
      let result = "loss";
      if (player > 21) result = "bust";
      else if (dealer > 21 || player > dealer) { result = "win"; payout = bet * 2; }
      else if (player === dealer) { result = "push"; payout = bet; }
      if (payout) changeBalance(interaction.user.id, payout, "payout", "Blackjack result");
      recordGame(interaction.user.id, "blackjack", bet, `${player}/${dealer}/${result}`, payout);
      const u = getUser(interaction.user.id);
      return interaction.reply(`🃏 You: **${player}** | Dealer: **${dealer}**\nResult: **${result}**${payout ? ` — payout **${payout.toLocaleString()}**` : ""}\nBalance: **${u.balance.toLocaleString()}**`);
    }

    if (name === "transfer") {
      const target = interaction.options.getUser("user");
      const amount = interaction.options.getInteger("amount");
      if (target.bot || target.id === interaction.user.id) return interaction.reply({content:"Choose another human member.",ephemeral:true});
      const sender = getUser(interaction.user.id);
      if (sender.balance < amount) return interaction.reply({content:"You don't have enough credits.",ephemeral:true});
      ensureUser(target);
      changeBalance(interaction.user.id, -amount, "transfer_sent", `Transfer to ${target.tag}`);
      changeBalance(target.id, amount, "transfer_received", `Transfer from ${interaction.user.tag}`);
      return interaction.reply(`✅ Transferred **${amount.toLocaleString()}** credits to ${target}.`);
    }

    if (name === "leaderboard") {
      const rows = db.prepare("SELECT username, balance FROM users ORDER BY balance DESC LIMIT 10").all();
      const text = rows.length ? rows.map((r,i)=>`**${i+1}.** ${r.username} — ${r.balance.toLocaleString()}`).join("\n") : "No players yet.";
      return interaction.reply(`🏆 **Leaderboard**\n${text}`);
    }

    if (name === "history") {
      const rows = db.prepare("SELECT game, bet, result, payout, created_at FROM games WHERE user_id = ? ORDER BY id DESC LIMIT 10").all(interaction.user.id);
      if (!rows.length) return interaction.reply("You haven't played any games yet.");
      const text = rows.map(r => {
        const time = Math.floor(r.created_at / 1000);
        return `<t:${time}:R> — **${r.game}** — bet ${r.bet.toLocaleString()} — ${r.result} — payout ${r.payout.toLocaleString()}`;
      }).join("\n");
      return interaction.reply(`📜 **Your recent games**\n${text}`);
    }

    if (name === "admin") {
      if (!admin(interaction)) return interaction.reply({content:"You don't have permission to use admin controls.",ephemeral:true});
      const sub = interaction.options.getSubcommand();
      const target = interaction.options.getUser("user");

      if (sub === "stats") {
        const users = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
        const total = db.prepare("SELECT COALESCE(SUM(balance),0) AS s FROM users").get().s;
        const games = db.prepare("SELECT COUNT(*) AS c FROM games").get().c;
        return interaction.reply(`📊 **Economy Stats**\nPlayers: **${users}**\nCredits in circulation: **${Number(total).toLocaleString()}**\nGames played: **${games}**`);
      }

      ensureUser(target);
      if (sub === "addbalance") {
        const amount = interaction.options.getInteger("amount");
        const balance = changeBalance(target.id, amount, "admin_add", `Added by ${interaction.user.tag}`);
        await log(interaction, `ADMIN: ${interaction.user.tag} added ${amount} to ${target.tag}.`);
        return interaction.reply(`✅ Added **${amount.toLocaleString()}** credits. New balance: **${balance.toLocaleString()}**`);
      }

      if (sub === "removebalance") {
        const amount = interaction.options.getInteger("amount");
        try {
          const balance = changeBalance(target.id, -amount, "admin_remove", `Removed by ${interaction.user.tag}`);
          await log(interaction, `ADMIN: ${interaction.user.tag} removed ${amount} from ${target.tag}.`);
          return interaction.reply(`✅ Removed **${amount.toLocaleString()}** credits. New balance: **${balance.toLocaleString()}**`);
        } catch {
          return interaction.reply({content:"That player doesn't have enough credits.",ephemeral:true});
        }
      }

      if (sub === "setbalance") {
        const amount = interaction.options.getInteger("amount");
        const current = getUser(target.id);
        const delta = amount - current.balance;
        db.prepare("UPDATE users SET balance = ? WHERE user_id = ?").run(amount, target.id);
        addTransaction(target.id, "admin_set", delta, amount, `Set by ${interaction.user.tag}`);
        await log(interaction, `ADMIN: ${interaction.user.tag} set ${target.tag}'s balance to ${amount}.`);
        return interaction.reply(`✅ ${target}'s balance is now **${amount.toLocaleString()}**`);
      }
    }
  } catch (err) {
    console.error(err);
    if (interaction.replied || interaction.deferred) {
      interaction.followUp({content:"Something went wrong while processing that command.",ephemeral:true}).catch(()=>{});
    } else {
      interaction.reply({content:"Something went wrong while processing that command.",ephemeral:true}).catch(()=>{});
    }
  }
});

(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
