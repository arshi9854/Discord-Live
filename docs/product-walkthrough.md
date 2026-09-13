# Pocket Post: a little welcome party

## The use case

A remote community is welcoming a new member. People can send a hello in their existing Discord channel, while the recipient opens Pocket Post as a shared guestbook. The same experience works for birthdays and farewells.

## A two-minute assignment demonstration

1. Open the real feed in two browser windows. Show the configured channel, Browser stream connected, and Discord connected. There should be no demo badge.
2. Ask two people to post unique test notes in the configured Discord channel.
3. Watch the notes arrive in both windows without refreshing, with their actual names.
4. Edit a source note: its existing message row updates without duplication.
5. Delete it: the message row disappears from both windows.
6. Reload one window: a fresh snapshot restores the retained message window. Explain that this is bounded recovery, not durable archival storage.

Keep the focus here, then trace the backend-to-browser code path described in [the setup guide](implementation-guide.md).

## Optional guestbook extra

Save a favorite, open **Saved**, and download it. Hearts remain in the same browser while their source messages are available. The text download contains all currently available hearted notes even if a search is active. This is secondary to the assignment's live stream.

## What guests should know

The guestbook is public and read-only. **Open Discord** opens the source channel; it does not submit anything by itself. Hearts are private browser bookmarks, not public likes. Up to 200 recent notes are retained, so download favorites before they leave the feed. A downloaded copy cannot be revoked by deleting the source message.

A labeled demo uses sample people and notes. Real mode shows actual Discord messages without fabricated cards, sentiment labels, or categories.
