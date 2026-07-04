// Composer with LLM dropdown
function Composer({ value, onChange, onSubmit, llm = 'Claude Sonnet 4.5', disabled = false, placeholder = '问点什么…', stopMode = false, autoFocus = false }) {
  const [v, setV] = React.useState(value || '');
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);
  React.useEffect(() => { setV(value || ''); }, [value]);

  const submit = () => {
    if (!v.trim() || disabled) return;
    onSubmit && onSubmit(v);
    setV('');
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <div className="composer">
      <textarea
        ref={inputRef}
        className="composer-text"
        rows={1}
        value={v}
        onChange={(e) => { setV(e.target.value); onChange && onChange(e.target.value); }}
        onKeyDown={onKey}
        placeholder={placeholder}
      />
      <div className="composer-row">
        <span className="composer-attach"><Icon name="plus" size={14} /></span>
        <span className="composer-llm">
          <Icon name="cube" size={13} color="var(--text-muted)" />
          <span>{llm}</span>
          <Icon name="caret-down" size={10} color="var(--text-muted)" />
        </span>
        {stopMode ? (
          <button
            className="composer-submit"
            style={{ background: 'var(--warning)', color: 'white' }}
            title="Stop"
          >
            <Icon name="stop" size={14} weight="bold" />
          </button>
        ) : (
          <button className="composer-submit" onClick={submit} title="Send">
            <Icon name="arrow-up" size={16} weight="bold" />
          </button>
        )}
      </div>
    </div>
  );
}

window.Composer = Composer;
