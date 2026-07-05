# bash completion for disco.
# Install: `brew install ikhoon/tap/disco` sets this up automatically; manually,
# drop it into ~/.local/share/bash-completion/completions/disco
# (bash-completion@2 auto-loads it), or source it from your ~/.bashrc.

_disco_complete() {
  local cur prev words cword
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"
  words=("${COMP_WORDS[@]}")
  cword=$COMP_CWORD

  # If prev is a flag that takes a value, complete that value.
  case "$prev" in
    --sort)
      COMPREPLY=( $(compgen -W "timestamp relevance" -- "$cur") )
      return
      ;;
    --shell)
      COMPREPLY=( $(compgen -W "zsh bash" -- "$cur") )
      return
      ;;
    --days|--limit|--since|--after|--count|--guild|--channel|--token)
      # Free-form values (numbers, times, snowflake IDs, secrets); no completion.
      return
      ;;
  esac

  # Subcommand position.
  if [[ $cword -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "read channel thread message mention search guilds channels dms whoami auth config completions help --help -h --version -V" -- "$cur") )
    return
  fi

  local sub="${words[1]}"
  local common="--json --no-color --bot --verbose -v --quiet -q"
  local flags="$common"

  case "$sub" in
    read|channel)
      flags="$common --days --limit --since"
      ;;
    thread)
      flags="$common --limit"
      ;;
    message|guilds|channels|whoami)
      flags="$common"
      ;;
    mention)
      # User-token only; --bot doesn't apply.
      flags="--json --no-color --verbose -v --quiet -q --after --since --guild --limit"
      ;;
    search)
      flags="$common --guild --channel --count --sort"
      ;;
    dms)
      # User-token only; --bot doesn't apply.
      flags="--json --no-color --verbose -v --quiet -q"
      ;;
    auth)
      if [[ $cword -eq 2 && "$cur" != -* ]]; then
        COMPREPLY=( $(compgen -W "status set clear" -- "$cur") )
        return
      fi
      flags="--token --bot --json --no-color"
      ;;
    config)
      if [[ $cword -eq 2 && "$cur" != -* ]]; then
        COMPREPLY=( $(compgen -W "show path set-guild" -- "$cur") )
        return
      fi
      flags=""
      ;;
    completions)
      flags="--shell --install"
      ;;
  esac

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "$flags" -- "$cur") )
  fi
}

complete -F _disco_complete disco
