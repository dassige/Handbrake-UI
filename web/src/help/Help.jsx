import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ChevronLeft, CircleHelp, Search } from 'lucide-react';
import { Modal } from '../components/Modal.jsx';
import content from './help.json';
import { searchHelp } from './search.js';
import { intlLocale, t, translatedHelp } from '../i18n/index.js';

/**
 * Help topics live in help.json (English) and help.<lang>.json (the same ids, translated; a
 * missing topic falls back to English): { title, body: string[], see?: string[] }.
 * Each body entry is one block — a paragraph, "- " bullet, "1. " numbered item or "### " heading —
 * with inline **bold**, `code`, [link](#topic.id) and [link](https://…).
 * Same format as dgsoft-image-manager; server/test/help.test.js checks ids and links.
 */
const isTopic = (id) => Object.hasOwn(content.topics, id);
/** The topics in the current language (call while rendering). */
const helpTopics = () => translatedHelp(content.topics);
const SEARCH = '@search';

const HelpContext = createContext({ open: () => {}, search: () => {} });

export const useHelpSearch = () => useContext(HelpContext).search;

/** Renders the help panel once for the whole app; <Help id=…/> buttons and the search open it. */
export function HelpProvider({ children }) {
  // A stack, so following a "related" link or a search result can go back.
  const [stack, setStack] = useState([]);
  const [query, setQuery] = useState('');
  const open = useCallback((id) => setStack([id]), []);
  const search = useCallback(() => setStack([SEARCH]), []);
  const close = () => {
    setStack([]);
    setQuery('');
  };
  const push = (id) => setStack((s) => [...s, id]);
  const current = stack.at(-1);
  const topics = helpTopics();
  const topic = current && current !== SEARCH ? topics[current] : null;
  const value = useMemo(() => ({ open, search }), [open, search]);

  const back = stack.length > 1 && (
    <button className="icon-btn" onClick={() => setStack((s) => s.slice(0, -1))} aria-label={t('common.back')}>
      <ChevronLeft size={16} />
    </button>
  );

  return (
    <HelpContext.Provider value={value}>
      {children}
      {current === SEARCH && (
        <Modal className="help-layer" ariaLabel={t('help.searchHelp')} title={<span className="help-title">{back}{t('help.searchHelp')}</span>} onClose={close}>
          <HelpSearch query={query} onQuery={setQuery} onTopic={push} />
        </Modal>
      )}
      {topic && (
        <Modal className="help-layer" ariaLabel={topic.title} title={<span className="help-title">{back}{topic.title}</span>} onClose={close}>
          <div className="help-body">
            <Blocks lines={topic.body} onTopic={push} />
            <div className="help-see">
              {topic.see?.some(isTopic) && (
                <>
                  <span className="small muted">{t('help.related')}</span>
                  {topic.see.filter(isTopic).map((id) => (
                    <button key={id} className="chip" onClick={() => push(id)}>{topics[id].title}</button>
                  ))}
                </>
              )}
              <span className="spacer" />
              <button className="btn ghost small" onClick={() => push(SEARCH)}>
                <Search size={14} /> {t('help.searchHelp')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </HelpContext.Provider>
  );
}

/** "Help" in the top bar: opens the help search. */
export function HelpSearchButton() {
  const search = useHelpSearch();
  return (
    <button className="btn ghost" onClick={search} title={t('help.searchHelp')} aria-label={t('help.searchHelp')}>
      <CircleHelp size={16} /> <span className="btn-label">{t('help.help')}</span>
    </button>
  );
}

function HelpSearch({ query, onQuery, onTopic }) {
  const topics = helpTopics();
  const locale = intlLocale();
  const searchable = useMemo(() => {
    const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
    return Object.keys(topics).map((id) => ({ id, title: topics[id].title, body: topics[id].body })).sort((a, b) => collator.compare(a.title, b.title));
    // topics changes only with the language
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);
  const hits = useMemo(() => searchHelp(query, searchable), [query, searchable]);
  const typed = query.trim() !== '';
  return (
    <div className="help-search">
      <div className="help-search-row">
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t('help.searchPlaceholder')}
          aria-label={t('help.searchHelp')}
        />
        <Help id="help.search" />
      </div>
      <p className="small muted" role="status">
        {!typed
          ? t('help.allTopics', { count: searchable.length })
          : hits.length
            ? t('help.hits', { count: hits.length })
            : t('help.noHits')}
      </p>
      <ul className="help-hits" aria-label={t('help.topics')}>
        {typed
          ? hits.map((h) => (
              <li key={h.id}>
                <button type="button" className="help-hit" onClick={() => onTopic(h.id)}>
                  <span className="help-hit-title"><Marked pieces={h.title} /></span>
                  <span className="help-hit-text"><Marked pieces={h.snippet} /></span>
                </button>
              </li>
            ))
          : searchable.map((t) => (
              <li key={t.id}>
                <button type="button" className="help-hit" onClick={() => onTopic(t.id)}>
                  <span className="help-hit-title">{t.title}</span>
                </button>
              </li>
            ))}
      </ul>
    </div>
  );
}

function Marked({ pieces }) {
  return <>{pieces.map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : p.text))}</>;
}

/** The small round “?” placed next to a title, section, field or button. */
export function Help({ id }) {
  const { open } = useContext(HelpContext);
  const title = helpTopics()[id]?.title ?? id;
  return (
    <button
      type="button"
      className="help-btn"
      title={t('help.helpFor', { title })}
      aria-label={t('help.helpFor', { title })}
      // Help buttons sit inside clickable rows and labels: don't let the click reach them.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        open(id);
      }}
    >
      ?
    </button>
  );
}

function Blocks({ lines, onTopic }) {
  const out = [];
  let list = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((t, i) => <li key={i}><Inline text={t} onTopic={onTopic} /></li>);
    out.push(list.ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>);
    list = null;
  };
  for (const line of lines) {
    const bullet = line.match(/^- (.*)$/s);
    const numbered = line.match(/^\d+\. (.*)$/s);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[1]);
      continue;
    }
    flush();
    if (line.startsWith('### ')) out.push(<h3 key={out.length}>{line.slice(4)}</h3>);
    else out.push(<p key={out.length}><Inline text={line} onTopic={onTopic} /></p>);
  }
  flush();
  return <>{out}</>;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function Inline({ text, onTopic }) {
  return (
    <>
      {text.split(INLINE).map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
        const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        if (link) {
          const [, label, href] = link;
          if (href.startsWith('#')) {
            const id = href.slice(1);
            return isTopic(id) ? <button key={i} className="link-btn" onClick={() => onTopic(id)}>{label}</button> : label;
          }
          return <a key={i} href={href} target="_blank" rel="noreferrer">{label}</a>;
        }
        return part;
      })}
    </>
  );
}
