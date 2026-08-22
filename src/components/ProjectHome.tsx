import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ProjectMeta } from '../utils/project'
import { deleteProject, listProjects } from '../utils/project'
import Icon from './Icon'
import { localizedErrorMessage, useLanguage } from '../i18n'

interface Props {
  activeName: string | null
  lastProjectName: string | null
  autosave: ProjectMeta | null
  hasContent: boolean
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  onClose: () => void
  onNew: () => void
  onOpen: (name: string) => Promise<void>
  onRestore: () => Promise<void>
  onSave: () => Promise<void>
  onSaveAs: () => void
  onManageFiles: () => void
}

const formatBytes = (bytes: number, empty: string) => {
  if (!bytes) return empty
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}MB`
}

const formatSavedAt = (savedAt: number, locale: string) => new Intl.DateTimeFormat(locale, {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(savedAt)

export default function ProjectHome({
  activeName, lastProjectName, autosave, hasContent, saveStatus,
  onClose, onNew, onOpen, onRestore, onSave, onSaveAs, onManageFiles,
}: Props) {
  const { language, t } = useLanguage()
  const locale = language === 'ko' ? 'ko-KR' : 'en-US'
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try { setProjects(await listProjects()) }
    catch (cause) { setError(t('프로젝트 목록을 읽지 못했습니다: ', 'Could not read the project list: ') + localizedErrorMessage(cause, '알 수 없는 오류', 'Unknown error')) }
  }, [t])
  useEffect(() => { void refresh() }, [refresh])

  const orderedProjects = useMemo(() => {
    if (!lastProjectName) return projects
    return [...projects].sort((a, b) => {
      if (a.name === lastProjectName) return -1
      if (b.name === lastProjectName) return 1
      return b.savedAt - a.savedAt
    })
  }, [lastProjectName, projects])

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label)
    setError('')
    try { await task() }
    catch (cause) { setError(localizedErrorMessage(cause, '작업을 마치지 못했습니다.', 'The operation could not be completed.')) }
    finally { setBusy('') }
  }

  const remove = async (name: string) => {
    if (!confirm(t(`'${name}' 프로젝트를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`, `Delete project '${name}'? This cannot be undone.`))) return
    await run(t('프로젝트 삭제 중…', 'Deleting project…'), async () => {
      await deleteProject(name)
      await refresh()
    })
  }

  return (
    <div className="project-home" role="dialog" aria-modal="true" aria-label={t('프로젝트 홈', 'Project home')}>
      <header className="project-home__head">
        <div className="project-home__brand">
          <span className="project-home__logo"><Icon name="brand" /></span>
          <div><b>{t('프로젝트 홈', 'Project home')}</b><small>{t('작업을 이어서 열거나 새 편집을 시작하세요.', 'Continue a project or start a new edit.')}</small></div>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label={t('프로젝트 홈 닫기', 'Close project home')} disabled={!!busy}><Icon name="close" /></button>
      </header>

      <main className="project-home__body">
        <section className="project-home__start" aria-labelledby="project-start-title">
          <div className="project-home__section-title">
            <div><h2 id="project-start-title">{t('작업 시작', 'Get started')}</h2><p>{t('자동 저장은 계속 유지됩니다.', 'Autosave remains available.')}</p></div>
            <button className="btn btn--sm" onClick={onManageFiles} disabled={!!busy}><Icon name="folder" />{t('백업 파일 관리', 'Manage backup files')}</button>
          </div>
          <div className="project-home__actions">
            <button className="project-action project-action--primary" onClick={onNew} disabled={!!busy}>
              <span className="project-action__icon"><Icon name="plus" /></span>
              <span><b>{t('새 프로젝트', 'New project')}</b><small>{t('빈 타임라인에서 시작', 'Start with an empty timeline')}</small></span>
            </button>
            {hasContent && (
              <button className="project-action" onClick={onClose} disabled={!!busy}>
                <span className="project-action__icon"><Icon name="video" /></span>
                <span><b>{t('현재 편집으로 돌아가기', 'Return to current edit')}</b><small>{activeName || t('저장되지 않은 작업', 'Unsaved work')}</small></span>
              </button>
            )}
          </div>
        </section>

        {autosave && !hasContent && (
          <section className="project-recovery" aria-label={t('자동 저장 복구', 'Autosave recovery')}>
            <span className="project-recovery__icon"><Icon name="undo" /></span>
            <div>
              <b>{t('이전에 작업하던 프로젝트가 있어요. 복원할까요?', 'A previous autosave is available. Restore it?')}</b>
              <small>{formatSavedAt(autosave.savedAt, locale)} · {t('자동 저장', 'Autosave')} · {formatBytes(autosave.size, t('미디어 없음', 'No media'))}</small>
            </div>
            <button className="btn btn--primary" onClick={() => run(t('자동 저장 복원 중…', 'Restoring autosave…'), onRestore)} disabled={!!busy}>{t('복원', 'Restore')}</button>
          </section>
        )}

        {hasContent && (
          <section className="project-current" aria-label={t('현재 프로젝트', 'Current project')}>
            <div className="project-current__info">
              <span className="project-current__icon"><Icon name="project" /></span>
              <div><small>{t('현재 프로젝트', 'Current project')}</small><b>{activeName || t('아직 이름 없음', 'Untitled')}</b></div>
            </div>
            <div className="project-current__actions">
              <span className={`project-current__status project-current__status--${saveStatus}`}>
                {saveStatus === 'saving' ? t('자동 저장 중', 'Autosaving') : saveStatus === 'error' ? t('자동 저장 확인 필요', 'Check autosave') : t('자동 저장됨', 'Autosaved')}
              </span>
              <button className="btn btn--primary" onClick={() => run(t('프로젝트 저장 중…', 'Saving project…'), async () => { await onSave(); await refresh() })} disabled={!!busy}>{t('프로젝트 저장', 'Save project')}</button>
              <button className="btn" onClick={onSaveAs} disabled={!!busy}>{t('다른 이름으로 저장', 'Save as')}</button>
            </div>
          </section>
        )}

        <section className="project-home__recent" aria-labelledby="recent-project-title">
          <div className="project-home__section-title">
            <div><h2 id="recent-project-title">{t('최근 프로젝트', 'Recent projects')}</h2><p>{t('저장된 순서대로 표시됩니다.', 'Sorted by most recently saved.')}</p></div>
          </div>
          {orderedProjects.length ? (
            <div className="project-grid">
              {orderedProjects.map((project) => (
                <article className={`project-card${project.name === activeName ? ' project-card--active' : ''}`} key={project.name}>
                  <button className="project-card__open" onClick={() => run(t(`'${project.name}' 여는 중…`, `Opening '${project.name}'…`), () => onOpen(project.name))} disabled={!!busy}>
                    <span className="project-card__thumb"><Icon name="video" /></span>
                    <span className="project-card__copy">
                      <b>{project.name}</b>
                      <small>{formatSavedAt(project.savedAt, locale)} · {formatBytes(project.size, t('미디어 없음', 'No media'))}</small>
                      {project.name === lastProjectName && <em>{t('마지막으로 연 프로젝트', 'Last opened')}</em>}
                    </span>
                  </button>
                  <button className="iconbtn iconbtn--sm project-card__delete" onClick={() => void remove(project.name)} disabled={!!busy} aria-label={t(`${project.name} 삭제`, `Delete ${project.name}`)}><Icon name="trash" /></button>
                </article>
              ))}
            </div>
          ) : (
            <div className="project-home__empty">
              <Icon name="project" />
              <b>{t('아직 저장된 프로젝트가 없습니다.', 'No saved projects yet.')}</b>
              <span>{t('편집을 시작한 뒤 프로젝트 이름을 정해 저장해보세요.', 'Start editing, then name and save your project.')}</span>
            </div>
          )}
        </section>

        {error && <div className="project-home__error" role="alert"><Icon name="warning" />{error}</div>}
      </main>

      {busy && <div className="project-home__busy" role="status"><span className="spinner" />{busy}</div>}
    </div>
  )
}
