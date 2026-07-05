# vhs tape for the disco CLI demo gif (assets/demo-cli.gif).
# Regenerate:  bun run demo   (= PATH="$PWD/demo/bin:$PATH" vhs demo/demo.tape)
# Uses demo/bin/disco — a mock that renders FICTIONAL fixtures through the real
# formatters (never touches the Discord API) — so the gif is safe to publish and
# always matches disco's actual output.
Output "assets/demo-cli.gif"

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 760
Set Padding 24
Set Theme "Dracula"
Set TypingSpeed 45ms

Hide
Type "PS1='$ '; clear"
Enter
Sleep 300ms
Show

Sleep 600ms
Type "disco read general"
Enter
Sleep 2.4s

Type "disco channels my-team"
Enter
Sleep 2.2s

Type "disco whoami"
Enter
Sleep 1.8s

Type "disco read general --json | jq '.data[].author.name'"
Enter
Sleep 2.5s
