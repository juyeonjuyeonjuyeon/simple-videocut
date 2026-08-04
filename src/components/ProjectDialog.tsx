import { useState, useEffect, useRef } from 'react'
import { useEditor } from '../store'
import {
  listProjects, saveProject, loadProject, deleteProject,
  projectToFileBlob, fileBlobToProject,
} from '../utils/project'
import type { ProjectMeta, ProjectState } from '../utils/project'
import { saveBlob } from '../utils/io'
import Icon from './Icon'

function snapshot(): ProjectState {
  const s = useEditor.getState()
  return {
    clips: s.clips, overlays: s.overlays, audios: s.audios, backgrounds: s.backgrounds, texts: s.texts,
    aspectRatio: s.aspectRatio, exportSettings: s.exportSettings,
  }
}

export default function ProjectDialog({ onClose }: { onClose: () => void }) {
  const replaceProject = useEditor((s) => s.replaceProject)
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [name, setName] = useState('내 프로젝트')
  const [busy, setBusy] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => listProjects().then(setProjects).catch(() => {})
  useEffect(() => { refresh() }, [])

  const doSave = async () => {
    setBusy('저장 중…')
    try { await saveProject(name.trim() || '무제', snapshot()); await refresh() }
    finally { setBusy('') }
  }
  const doLoad = async (n: string) => {
    setBusy('불러오는 중…')
    try { const p = await loadProject(n); if (p) { replaceProject(p); onClose() } }
    catch (error) { alert('복원 실패: ' + (error as Error).message) }
    finally { setBusy('') }
  }
  const doDelete = async (n: string) => {
    if (!confirm(`'${n}' 프로젝트를 삭제할까요?`)) return
    await deleteProject(n)
    refresh()
  }
  const doExportFile = async () => {
    setBusy('파일 만드는 중…')
    try {
      const blob = await projectToFileBlob(name.trim() || '무제', snapshot())
      await saveBlob(blob, `${name.trim() || '무제'}.scut.json`)
    } catch { /* cancelled */ } finally { setBusy('') }
  }
  const doShareFile = async () => {
    setBusy('공유 파일 만드는 중…')
    try {
      const projectName = name.trim() || '무제'
      const blob = await projectToFileBlob(projectName, snapshot())
      const file = new File([blob], `${projectName}.scut`, { type: 'application/json' })
      if (!navigator.share || !navigator.canShare?.({ files: [file] })) throw new Error('이 기기에서는 파일 공유를 지원하지 않습니다.')
      await navigator.share({ title: `${projectName} — 간단컷 프로젝트`, files: [file] })
    } catch (error) {
      if ((error as Error).name !== 'AbortError') alert((error as Error).message)
    } finally { setBusy('') }
  }
  const doImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy('가져오는 중…')
    try { const p = await fileBlobToProject(f); replaceProject(p); onClose() }
    catch (err) { alert('가져오기 실패: ' + (err as Error).message) }
    finally { setBusy('') }
  }

  return (
    <div className="modal" onClick={busy ? undefined : onClose}>
      <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>프로젝트</h2>
          {!busy && <button className="iconbtn" onClick={onClose} aria-label="닫기">✕</button>}
        </div>

        <div className="modal__field">
          <span>현재 프로젝트 저장</span>
          <div className="filename">
            <input className="filename__input" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn--primary" onClick={doSave} disabled={!!busy}>💾 저장</button>
          </div>
        </div>

        <div className="modal__field">
          <span>저장된 프로젝트</span>
          {projects.length === 0 ? (
            <div className="modal__hint">저장된 프로젝트가 없습니다.</div>
          ) : (
            <div className="projlist">
              {projects.map((p) => (
                <div className="projrow" key={p.name}>
                  <div className="projrow__info">
                    <b>{p.name}</b>
                    <small>{new Date(p.savedAt).toLocaleString()} · {(p.size / 1024 / 1024).toFixed(1)}MB</small>
                  </div>
                  <button className="btn btn--sm" onClick={() => doLoad(p.name)} disabled={!!busy}>열기</button>
                  <button className="btn btn--sm btn--danger" onClick={() => doDelete(p.name)} disabled={!!busy}>삭제</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal__field">
          <span>파일로 백업 (아이클라우드 드라이브 등)</span>
          <div className="inspector__row">
            <button className="btn btn--sm" onClick={doExportFile} disabled={!!busy}><Icon name="upload" />파일로 내보내기</button>
            <button className="btn btn--sm" onClick={doShareFile} disabled={!!busy}><Icon name="share" />공유하기</button>
            <button className="btn btn--sm" onClick={() => fileRef.current?.click()} disabled={!!busy}><Icon name="download" />파일에서 가져오기</button>
          </div>
          <div className="modal__hint">저장 위치 선택을 지원하면 아이클라우드 드라이브 폴더에 바로 저장할 수 있어요.</div>
          <input ref={fileRef} type="file" accept=".scut,.json,application/json" hidden onChange={doImportFile} />
        </div>

        {busy && (
          <div className="loading-overlay">
            <div className="spinner" />
            <div>{busy}</div>
          </div>
        )}
      </div>
    </div>
  )
}
