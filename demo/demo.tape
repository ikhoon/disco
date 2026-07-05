# vhs tape for the disco CLI demo gif (assets/demo-cli.gif).
# Regenerate:  bun run demo   (= PATH="$PWD/demo/bin:$PATH" vhs demo/demo.tape)
# Uses demo/bin/disco — a mock that prints fictional output and never touches
# the Discord API — so the gif is safe to publish.
Output "assets/demo-cli.gif"

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 720
Set Padding 24
Set Theme "Dracula"
Set TypingSpeed 45ms

Hide
Type "PS1='$ '; clear"
Enter
Sleep 300ms
Show

Sleep 600ms
Type "disco mention --after 2h"
Enter
Sleep 1.8s

Type "disco search 'deploy failed'"
Enter
Sleep 1.8s

Type "disco channels 111111111111111111"
Enter
Sleep 2s

Type "disco mention --after 1d --json | jq '.data[].permalink'"
Enter
Sleep 2.5s
