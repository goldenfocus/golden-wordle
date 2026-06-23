// Wordul — English locale (the source-of-truth / fallback dictionary).
//
// Keys are dotted by surface (endscreen.*, etc.). To add a language, copy this file
// to locales/<code>.js, translate the VALUES (keep the keys + {placeholders}), and
// register it in i18n.js → LOCALES. New copy lands here first.

export const en = {
  // End-of-game stats / word card
  "endscreen.theWord": "THE WORD",
  "endscreen.lookup": "Look it up ↗",
  "endscreen.lookupAi": "Look it up with AI ✦",
  "endscreen.looking": "Looking it up…",
  "endscreen.noEntry": "No dictionary entry — tap “Look it up” to explore.",
  "endscreen.offline": "Definition unavailable offline — tap “Look it up”.",
  "endscreen.goldBreakdown": "Gold breakdown",
  "endscreen.youWon": "🎉 You got it in {n}!",
  "endscreen.someoneWon": "{who} got it first.",
  "endscreen.outpaced": "{who} beat you to it.",
  "endscreen.playAgain": "Play again",
  "endscreen.rematch": "Rematch",
  "endscreen.joinNext": "Join next game →",
  "endscreen.createGame": "Create your own game",
  "endscreen.mainMenu": "Main menu",
  "endscreen.saveCard": "Save card",
  "rematch.waiting": "Waiting for {who}… ✕",
  "rematch.prompt": "{who} wants to run it back",
  "rematch.accept": "Accept",
  "rematch.decline": "Decline",
  "rematch.declined": "{who} isn't up for another — nice game!",
  "rematch.timeout": "{who} didn't answer — nice game!",
  "rematch.left": "{who} stepped away — nice game!",
  "endscreen.nobodyWon": "Nobody got it this time.",
  "endscreen.didYouKnow": "Did you know",

  // Stats modal (server-truth)
  "stats.needUsername": "Pick a username to track your stats.",
  "stats.loadFailed": "Couldn’t load your stats right now.",

  // Mode picker (lobby)
  "mode.heading": "Choose a mode",
  "mode.comingSoon": "soon",
  "mode.race.label": "Live Race",
  "mode.race.blurb": "Everyone sprints the same word at once.",
  "mode.longgame.label": "Long Game",
  "mode.longgame.blurb": "Turn-based. 3-day clock. Play a row, then wait.",
  "mode.challenge.label": "Open Challenge",
  "mode.challenge.blurb": "One word, always open. Beat the standing record.",

  // Wordul of the Day
  "daily.entryTitle": "Today's Wordul.",
  "daily.entrySub": "One word. The whole world. Pick a username to play.",
  "daily.entryCta": "Play today →",
  "daily.boardTitle": "Wordul of the Day · {date}",
  "daily.roundScorePrefix": "Round",
  "race.scorePrefix": "Score",
  // Gold ledger (public profile § — every mint on the record, drill into the parts)
  "gold.history.title": "Gold ledger",
  "gold.history.empty": "No gold earned yet — solve a daily.",
  "gold.history.dateToday": "Today",
  "gold.history.reason.daily": "Daily solve",
  "gold.history.reason.cashout": "Race win",
  "gold.history.part.score": "score",
  "gold.history.part.daily": "daily",
  "gold.history.part.speed": "speed",
  // The Broadsheet daily reveal (kicker → headline word → entry → minted credit)
  "daily.revealKickerWon": "And the word is",
  "daily.revealKickerLost": "The word was",
  "daily.revealMint": "◆ +{gold} minted to your name",
  "daily.revealStory": "See the full story of {word}",
  "daily.share": "Share today's run",
  "daily.home": "‹ Home",
  "daily.storyFallbackTitle": "The story behind the word",
  "daily.storyKicker": "Why this word",
  "daily.keepPlaying": "Keep playing",
  "daily.browsePast": "Browse past days →",
  "daily.prevDay": "Previous day",
  "daily.nextDay": "Next day",
  "daily.loadingDay": "Loading that day…",
  // The post-word bridge: one challenge CTA + the action rail under it
  "daily.dare": "◆ Dare ◆",
  "daily.dareSub": "Invite a friend to today's word",
  "daily.actionWiki": "Wiki",
  "daily.actionRecap": "Recap",
  "daily.actionPast": "Past days",
  "daily.actionHome": "Home",
  "daily.lbShowAll": "Show all",
  "daily.lbRecap": "Full day recap",
  "daily.archiveTitle": "Every Wordul of the Day",

  // Settlement screen (settle.js)
  "settle.dailyBonus": "daily bonus",
  "settle.speedBonus": "speed",
  "settle.caption.dailyBonus": "daily goody + speed",
  "settle.toWallet": "to your wallet",
  "settle.net": "net",
  "settle.bust": "buy-in was your max loss",
  "settle.skip": "Tap to continue",
  "settle.theWordIs": "the word is",
  "settle.theWordWas": "the word was",
  // Animation beat captions
  "settle.caption.eachCoinSplits": "every coin splits",
  "settle.caption.powerUps": "power-ups",
  "settle.caption.winBonus": "win bonus",
  "settle.caption.supernova": "supernova",
  "settle.caption.tableKeepsIt": "the table keeps it",
};
