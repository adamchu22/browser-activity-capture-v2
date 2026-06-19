// Shared UI strings for the popup + mic-permission page, in the three languages
// we share this with first: English, Spanish, Portuguese.
//
// Deliberately NOT chrome.i18n / _locales: that follows the browser's UI locale
// and can't be switched from inside the UI. Here the user picks the language with
// the header toggle and it persists in chrome.storage.local under `lang`.
//
// Plain (non-module) script so it works in both the module popup (reads
// window.BAC_I18N) and the classic mic-permission script. Strings with {name}/{e}
// placeholders are filled by t(lang, key, vars). HTML strings (blockHint, micBody)
// are authored, never user input — safe to assign via innerHTML.
(function () {
  const STR = {
    en: {
      appName: "Activity Capture",
      start: "Start recording",
      recMic: "Record microphone (narration)",
      micOn: "Microphone enabled ✓",
      micOff: "Microphone not enabled — narration won't record.",
      enableMic: "Enable microphone…",
      pause: "Pause",
      resume: "Resume",
      stop: "Stop & export",
      whatTitle: "What are you doing in this recording?",
      optional: "(optional)",
      taskPh: "e.g. Issue a refund for a damaged order in Distru",
      whyTitle: "Why are you recording?",
      pSkill: "Build a skill / automation",
      pDocs: "Documentation / SOP",
      pUx: "UX / product feedback",
      pUi: "Propose UI changes",
      pImprove: "Find a better / faster way",
      pResearch: "Competitive / product research",
      pGeneral: "General capture",
      settings: "Settings",
      blockTitle: "Never record on",
      blockNote: "(one host per line)",
      blockHint:
        "Switching to one of these tabs auto-pauses the whole recording (video too) until you leave it. A parent domain (e.g. <code>1password.com</code>) also covers its subdomains.",
      onFinish: "When a recording finishes",
      saveDownloads: "The capture is saved to your browser’s Downloads folder.",
      saveFolder: "Auto-save to a folder",
      chooseFolder: "Choose folder…",
      saveAsk: "Ask me where to save & name it each time",
      askHint: "“Ask” opens your file explorer to pick any location and rename — every time.",
      saved: "Saved ✓",
      folderSaving: "Saving to: {name}",
      folderNone: "No folder chosen — saves to Downloads.",
      folderLost: "⚠ Lost access to “{name}” — click Choose folder to restore it.",
      stStarting: "Starting…",
      stRecording: "Recording…",
      stPaused: "Paused",
      stPickShare: "Choose a screen/window to share in the dialog…",
      stMicPrompt: "Allow microphone access when your browser asks, then press Start again.",
      stExporting: "Exporting bundle…",
      stFolderDenied: "Folder access wasn’t granted.",
      stPickerFail: "Couldn’t open the folder picker.",
      stStartFail: "Couldn't start.",
      micHead: "Enable microphone narration",
      micBody:
        "Browser Activity Capture records your spoken narration into the screen recording. Chrome will ask for microphone access — choose <b>Allow</b>. You only need to do this once.",
      micRequesting: "Requesting microphone access…",
      micRetry: "Try again",
      micOkMsg: "✓ Microphone enabled.",
      micDone: "Granted. You can close this window and press Start — your voice will be included.",
      micBlocked:
        "Microphone blocked: {e}. Check the mic icon in the address bar, or macOS System Settings → Privacy & Security → Microphone (allow Chrome), then try again.",
      cdBold: "Say out loud what you're about to do.",
      cdSmall: "Your narration gives the AI the most context.",
    },
    es: {
      appName: "Captura de Actividad",
      start: "Iniciar grabación",
      recMic: "Grabar micrófono (narración)",
      micOn: "Micrófono activado ✓",
      micOff: "Micrófono no activado — la narración no se grabará.",
      enableMic: "Activar micrófono…",
      pause: "Pausar",
      resume: "Reanudar",
      stop: "Detener y exportar",
      whatTitle: "¿Qué estás haciendo en esta grabación?",
      optional: "(opcional)",
      taskPh: "ej. Emitir un reembolso por un pedido dañado en Distru",
      whyTitle: "¿Por qué estás grabando?",
      pSkill: "Crear una habilidad / automatización",
      pDocs: "Documentación / SOP",
      pUx: "Comentarios de UX / producto",
      pUi: "Proponer cambios de UI",
      pImprove: "Encontrar una forma mejor / más rápida",
      pResearch: "Investigación competitiva / de producto",
      pGeneral: "Captura general",
      settings: "Ajustes",
      blockTitle: "Nunca grabar en",
      blockNote: "(un host por línea)",
      blockHint:
        "Cambiar a una de estas pestañas pausa automáticamente toda la grabación (también el video) hasta que la dejes. Un dominio principal (p. ej. <code>1password.com</code>) también cubre sus subdominios.",
      onFinish: "Cuando termina una grabación",
      saveDownloads: "La captura se guarda en la carpeta de Descargas de tu navegador.",
      saveFolder: "Guardar automáticamente en una carpeta",
      chooseFolder: "Elegir carpeta…",
      saveAsk: "Preguntarme dónde guardar y nombrarlo cada vez",
      askHint: "“Preguntar” abre tu explorador de archivos para elegir cualquier ubicación y renombrar — cada vez.",
      saved: "Guardado ✓",
      folderSaving: "Guardando en: {name}",
      folderNone: "Ninguna carpeta elegida — se guarda en Descargas.",
      folderLost: "⚠ Se perdió el acceso a “{name}” — haz clic en Elegir carpeta para restaurarlo.",
      stStarting: "Iniciando…",
      stRecording: "Grabando…",
      stPaused: "En pausa",
      stPickShare: "Elige una pantalla/ventana para compartir en el diálogo…",
      stMicPrompt: "Permite el acceso al micrófono cuando el navegador lo pida, luego presiona Iniciar de nuevo.",
      stExporting: "Exportando paquete…",
      stFolderDenied: "No se concedió acceso a la carpeta.",
      stPickerFail: "No se pudo abrir el selector de carpetas.",
      stStartFail: "No se pudo iniciar.",
      micHead: "Activar narración por micrófono",
      micBody:
        "Browser Activity Capture graba tu narración hablada en la grabación de pantalla. Chrome pedirá acceso al micrófono — elige <b>Permitir</b>. Solo necesitas hacerlo una vez.",
      micRequesting: "Solicitando acceso al micrófono…",
      micRetry: "Intentar de nuevo",
      micOkMsg: "✓ Micrófono activado.",
      micDone: "Concedido. Puedes cerrar esta ventana y presionar Iniciar — tu voz se incluirá.",
      micBlocked:
        "Micrófono bloqueado: {e}. Revisa el icono del micrófono en la barra de direcciones, o Ajustes del Sistema de macOS → Privacidad y seguridad → Micrófono (permitir Chrome), luego intenta de nuevo.",
      cdBold: "Di en voz alta lo que vas a hacer.",
      cdSmall: "Tu narración le da a la IA el máximo contexto.",
    },
    pt: {
      appName: "Captura de Atividade",
      start: "Iniciar gravação",
      recMic: "Gravar microfone (narração)",
      micOn: "Microfone ativado ✓",
      micOff: "Microfone não ativado — a narração não será gravada.",
      enableMic: "Ativar microfone…",
      pause: "Pausar",
      resume: "Retomar",
      stop: "Parar e exportar",
      whatTitle: "O que você está fazendo nesta gravação?",
      optional: "(opcional)",
      taskPh: "ex. Emitir um reembolso por um pedido danificado no Distru",
      whyTitle: "Por que você está gravando?",
      pSkill: "Criar uma habilidade / automação",
      pDocs: "Documentação / SOP",
      pUx: "Feedback de UX / produto",
      pUi: "Propor mudanças de UI",
      pImprove: "Encontrar uma forma melhor / mais rápida",
      pResearch: "Pesquisa competitiva / de produto",
      pGeneral: "Captura geral",
      settings: "Configurações",
      blockTitle: "Nunca gravar em",
      blockNote: "(um host por linha)",
      blockHint:
        "Mudar para uma dessas abas pausa automaticamente toda a gravação (o vídeo também) até você sair. Um domínio principal (ex. <code>1password.com</code>) também cobre seus subdomínios.",
      onFinish: "Quando uma gravação termina",
      saveDownloads: "A captura é salva na pasta de Downloads do seu navegador.",
      saveFolder: "Salvar automaticamente em uma pasta",
      chooseFolder: "Escolher pasta…",
      saveAsk: "Perguntar onde salvar e nomear a cada vez",
      askHint: "“Perguntar” abre seu explorador de arquivos para escolher qualquer local e renomear — sempre.",
      saved: "Salvo ✓",
      folderSaving: "Salvando em: {name}",
      folderNone: "Nenhuma pasta escolhida — salva em Downloads.",
      folderLost: "⚠ Acesso perdido a “{name}” — clique em Escolher pasta para restaurá-lo.",
      stStarting: "Iniciando…",
      stRecording: "Gravando…",
      stPaused: "Pausado",
      stPickShare: "Escolha uma tela/janela para compartilhar na caixa de diálogo…",
      stMicPrompt: "Permita o acesso ao microfone quando o navegador pedir e pressione Iniciar novamente.",
      stExporting: "Exportando pacote…",
      stFolderDenied: "O acesso à pasta não foi concedido.",
      stPickerFail: "Não foi possível abrir o seletor de pastas.",
      stStartFail: "Não foi possível iniciar.",
      micHead: "Ativar narração por microfone",
      micBody:
        "O Browser Activity Capture grava sua narração falada na gravação de tela. O Chrome pedirá acesso ao microfone — escolha <b>Permitir</b>. Você só precisa fazer isso uma vez.",
      micRequesting: "Solicitando acesso ao microfone…",
      micRetry: "Tentar novamente",
      micOkMsg: "✓ Microfone ativado.",
      micDone: "Concedido. Você pode fechar esta janela e pressionar Iniciar — sua voz será incluída.",
      micBlocked:
        "Microfone bloqueado: {e}. Verifique o ícone do microfone na barra de endereços, ou Ajustes do Sistema do macOS → Privacidade e Segurança → Microfone (permitir o Chrome), depois tente novamente.",
      cdBold: "Diga em voz alta o que você vai fazer.",
      cdSmall: "Sua narração dá à IA o máximo de contexto.",
    },
  };

  const LANGS = ["en", "es", "pt"];

  function normalize(lang) {
    if (!lang) return null;
    const base = String(lang).toLowerCase().slice(0, 2);
    return LANGS.includes(base) ? base : null;
  }

  function t(lang, key, vars) {
    const table = STR[normalize(lang) || "en"];
    let s = (table && table[key]) != null ? table[key] : STR.en[key];
    if (s == null) return key;
    if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }

  (typeof window !== "undefined" ? window : self).BAC_I18N = {
    langs: LANGS,
    labels: { en: "EN", es: "ES", pt: "PT" },
    normalize,
    t,
    // Best first guess from the browser before the user has chosen.
    detect() {
      const cands = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) || [];
      for (const c of cands) {
        const n = normalize(c);
        if (n) return n;
      }
      return "en";
    },
  };
})();
