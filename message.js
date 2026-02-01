// message.js
// Responsible for rendering a single chat message into the UI.
// Used by SimulationEngine, MessagePool.streamToUI, and manual inserts.

(function globalMessageRenderer(){
  if (window.renderMessage) return;

  function escapeHTML(str){
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatTime(ts){
    try{
      const d = new Date(ts || Date.now());
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }catch{
      return '';
    }
  }

  function renderMessage(message, autoScroll = true){
    if (!message) return;

    const chat = document.getElementById('chat');
    if (!chat) return;

    const row = document.createElement('div');
    row.className = 'message-row';

    if (message.isOwn) row.classList.add('own');

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const author = document.createElement('div');
    author.className = 'message-author';
    author.textContent =
      message.displayName ||
      message.name ||
      'Unknown';

    const text = document.createElement('div');
    text.className = 'message-text';
    text.innerHTML = escapeHTML(message.text || '');

    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = formatTime(message.timestamp);

    bubble.appendChild(author);
    bubble.appendChild(text);
    bubble.appendChild(time);
    row.appendChild(bubble);
    chat.appendChild(row);

    if (autoScroll){
      chat.scrollTop = chat.scrollHeight;
    }
  }

  window.renderMessage = renderMessage;

  console.info('message.js loaded — renderMessage ready.');
})();
