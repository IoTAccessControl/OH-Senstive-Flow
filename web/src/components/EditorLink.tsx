import { buildEditorHrefForPath } from '../utils/editor';

type EditorLinkProps = {
  repoRoot?: string;
  wslDistroName?: string;
  filePath: string;
  line?: number;
  column?: number;
  label?: string;
  title?: string;
  className?: string;
};

export function OpenInEditorLink({
  repoRoot,
  wslDistroName,
  filePath,
  line,
  column,
  label,
  title,
  className,
}: EditorLinkProps) {
  const href = buildEditorHrefForPath({ repoRoot, wslDistroName, filePath, line, column });
  if (!href) return null;

  const text = (label ?? filePath).trim();
  if (!text) return null;

  const safeTitle = title ?? `在本地编辑器打开${line ? `（第 ${line} 行）` : ''}`;
  return (
    <a
      className={className ?? 'filePathLink'}
      href={href}
      title={safeTitle}
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      {text}
    </a>
  );
}

export function FilePathWithEditorLink({
  repoRoot,
  wslDistroName,
  filePath,
  line,
  column,
  label,
  title,
  className,
}: EditorLinkProps) {
  const displayText = (label ?? filePath).trim();
  if (!displayText) return <span className={className ?? 'filePathText'} />;

  const href = buildEditorHrefForPath({ repoRoot, wslDistroName, filePath, line, column });
  if (!href) return <span className={className ?? 'filePathText'}>{displayText}</span>;

  const safeTitle = title ?? `在本地编辑器打开${line ? `（第 ${line} 行）` : ''}`;
  return (
    <a
      className={className ?? 'filePathLink'}
      href={href}
      title={safeTitle}
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      {displayText}
    </a>
  );
}
