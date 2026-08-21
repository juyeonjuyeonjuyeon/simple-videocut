import { useEffect, useMemo, useState } from 'react'
import type { ProjectMeta } from '../utils/project'
import { deleteProject, listProjects } from '../utils/project'
import Icon from './Icon'

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

const formatBytes = (bytes: number) => {
  if (!bytes) return '미디어 없음'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}MB`
}

const formatSavedAt = (savedAt: number) => new Intl.DateTimeFormat('ko-KR', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(savedAt)

export default function ProjectHome({
  activeName, lastProjectName, autosave, hasContent, saveStatus,
  onClose, onNew, onOpen, onRestore, onSave, onSaveAs, onManageFiles,
}: Props) {
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const refresh = async () => {
    try { setProjects(await listProjects()) }
    catch (cause) { setError(`프로젝트 목록을 읽지 못했습니다: ${(cause as Error).message}`) }
  }
  useEffect(() => { void refresh() }, [])

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
    catch (cause) { setError((cause as Error).message || '작업을 마치지 못했습니다.') }
    finally { setBusy('') }
  }

  const remove = async (name: string) => {
    if (!confirm(`'${name}' 프로젝트를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return
    await run('프로젝트 삭제 중…', async () => {
      await deleteProject(name)
      await refresh()
    })
  }

  return (
    <div className="project-home" role="dialog" aria-modal="true" aria-label="프로젝트 홈">
      <header className="project-home__head">
        <div className="project-home__brand">
          <span className="project-home__logo"><Icon name="brand" /></span>
          <div><b>프로젝트 홈</b><small>작업을 이어서 열거나 새 편집을 시작하세요.</small></div>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="프로젝트 홈 닫기" disabled={!!busy}><Icon name="close" /></button>
      </header>

      <main className="project-home__body">
        <section className="project-home__start" aria-labelledby="project-start-title">
          <div className="project-home__section-title">
            <div><h2 id="project-start-title">작업 시작</h2><p>자동 저장은 계속 유지됩니다.</p></div>
            <button className="btn btn--sm" onClick={onManageFiles} disabled={!!busy}><Icon name="folder" />백업 파일 관리</button>
          </div>
          <div className="project-home__actions">
            <button className="project-action project-action--primary" onClick={onNew} disabled={!!busy}>
              <span className="project-action__icon"><Icon name="plus" /></span>
              <span><b>새 프로젝트</b><small>빈 타임라인에서 시작</small></span>
            </button>
            {hasContent && (
              <button className="project-action" onClick={onClose} disabled={!!busy}>
                <span className="project-action__icon"><Icon name="video" /></span>
                <span><b>현재 편집으로 돌아가기</b><small>{activeName || '저장되지 않은 작업'}</small></span>
              </button>
            )}
          </div>
        </section>

        {autosave && !hasContent && (
          <section className="project-recovery" aria-label="자동 저장 복구">
            <span className="project-recovery__icon"><Icon name="undo" /></span>
            <div>
              <b>이전에 작업하던 프로젝트가 있어요. 복원할까요?</b>
              <small>{formatSavedAt(autosave.savedAt)} 자동 저장 · {formatBytes(autosave.size)}</small>
            </div>
            <button className="btn btn--primary" onClick={() => run('자동 저장 복원 중…', onRestore)} disabled={!!busy}>복원</button>
          </section>
        )}

        {hasContent && (
          <section className="project-current" aria-label="현재 프로젝트">
            <div className="project-current__info">
              <span className="project-current__icon"><Icon name="project" /></span>
              <div><small>현재 프로젝트</small><b>{activeName || '아직 이름 없음'}</b></div>
            </div>
            <div className="project-current__actions">
              <span className={`project-current__status project-current__status--${saveStatus}`}>
                {saveStatus === 'saving' ? '자동 저장 중' : saveStatus === 'error' ? '자동 저장 확인 필요' : '자동 저장됨'}
              </span>
              <button className="btn btn--primary" onClick={() => run('프로젝트 저장 중…', async () => { await onSave(); await refresh() })} disabled={!!busy}>프로젝트 저장</button>
              <button className="btn" onClick={onSaveAs} disabled={!!busy}>다른 이름으로 저장</button>
            </div>
          </section>
        )}

        <section className="project-home__recent" aria-labelledby="recent-project-title">
          <div className="project-home__section-title">
            <div><h2 id="recent-project-title">최근 프로젝트</h2><p>저장된 순서대로 표시됩니다.</p></div>
          </div>
          {orderedProjects.length ? (
            <div className="project-grid">
              {orderedProjects.map((project) => (
                <article className={`project-card${project.name === activeName ? ' project-card--active' : ''}`} key={project.name}>
                  <button className="project-card__open" onClick={() => run(`'${project.name}' 여는 중…`, () => onOpen(project.name))} disabled={!!busy}>
                    <span className="project-card__thumb"><Icon name="video" /></span>
                    <span className="project-card__copy">
                      <b>{project.name}</b>
                      <small>{formatSavedAt(project.savedAt)} · {formatBytes(project.size)}</small>
                      {project.name === lastProjectName && <em>마지막으로 연 프로젝트</em>}
                    </span>
                  </button>
                  <button className="iconbtn iconbtn--sm project-card__delete" onClick={() => void remove(project.name)} disabled={!!busy} aria-label={`${project.name} 삭제`} title="프로젝트 삭제"><Icon name="trash" /></button>
                </article>
              ))}
            </div>
          ) : (
            <div className="project-home__empty">
              <Icon name="project" />
              <b>아직 저장된 프로젝트가 없습니다.</b>
              <span>편집을 시작한 뒤 프로젝트 이름을 정해 저장해보세요.</span>
            </div>
          )}
        </section>

        {error && <div className="project-home__error" role="alert"><Icon name="warning" />{error}</div>}
      </main>

      {busy && <div className="project-home__busy" role="status"><span className="spinner" />{busy}</div>}
    </div>
  )
}
