import { useState, useEffect, useRef } from 'react'
import { useEditor } from '../store'
import {
  listProjects, saveProject, loadProject, deleteProject,
  projectToFileBlob, fileBlobToProjectWithMeta,
} from '../utils/project'
import type { ProjectMeta, ProjectState } from '../utils/project'
import { saveBlob } from '../utils/io'
import Icon from './Icon'
import { localizedErrorMessage, useLanguage } from '../i18n'

function snapshot(): ProjectState {
  const s = useEditor.getState()
  return {
    mediaLibrary: s.mediaLibrary,
    clips: s.clips, overlays: s.overlays, audios: s.audios, backgrounds: s.backgrounds, texts: s.texts,
    markers: s.markers,
    groups: s.groups,
    visualOrder: s.visualOrder,
    aspectRatio: s.aspectRatio, canvasWidth: s.canvasWidth, canvasHeight: s.canvasHeight, exportSettings: s.exportSettings,
  }
}

interface Props {
  onClose: () => void
  activeName: string | null
  initialMode?: 'manage' | 'saveAs'
  onActiveProjectChange: (name: string | null) => void
  onSaved?: (name: string) => void
}

export default function ProjectDialog({ onClose, activeName, initialMode = 'manage', onActiveProjectChange, onSaved }: Props) {
  const { language, t } = useLanguage()
  const replaceProject = useEditor((s) => s.replaceProject)
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [name, setName] = useState(activeName ? t(`${activeName} 복사본`, `${activeName} copy`) : t('내 프로젝트', 'My project'))
  const [saveAs, setSaveAs] = useState(initialMode === 'saveAs' || !activeName)
  const [busy, setBusy] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => listProjects().then(setProjects).catch(() => {})
  useEffect(() => { refresh() }, [])

  const persist = async (projectName: string, closeAfter = false) => {
    setBusy(t('저장 중…', 'Saving…'))
    try {
      await saveProject(projectName, snapshot())
      onActiveProjectChange(projectName)
      onSaved?.(projectName)
      await refresh()
      setSaveAs(false)
      if (closeAfter) onClose()
    }
    catch (error) { alert(t('저장 실패: ', 'Save failed: ') + localizedErrorMessage(error, '알 수 없는 오류', 'Unknown error')) }
    finally { setBusy('') }
  }
  const doSave = async () => {
    if (!activeName) { setSaveAs(true); return }
    await persist(activeName, true)
  }
  const doSaveAs = async () => {
    const projectName = name.trim() || t('무제', 'Untitled')
    const exists = projects.some((project) => project.name === projectName)
    if (exists && projectName !== activeName && !confirm(t(`'${projectName}' 프로젝트를 덮어쓸까요?`, `Overwrite project '${projectName}'?`))) return
    await persist(projectName, true)
  }
  const doLoad = async (n: string) => {
    setBusy(t('불러오는 중…', 'Loading…'))
    try { const p = await loadProject(n); if (p) { replaceProject(p); onActiveProjectChange(n); onClose() } }
    catch (error) { alert(t('복원 실패: ', 'Restore failed: ') + localizedErrorMessage(error, '알 수 없는 오류', 'Unknown error')) }
    finally { setBusy('') }
  }
  const doDelete = async (n: string) => {
    if (!confirm(t(`'${n}' 프로젝트를 삭제할까요?`, `Delete project '${n}'?`))) return
    try {
      await deleteProject(n)
      if (activeName === n) onActiveProjectChange(null)
      await refresh()
    }
    catch (error) { alert(t('삭제 실패: ', 'Delete failed: ') + localizedErrorMessage(error, '알 수 없는 오류', 'Unknown error')) }
  }
  const doExportFile = async () => {
    setBusy(t('파일 만드는 중…', 'Creating file…'))
    try {
      const blob = await projectToFileBlob(name.trim() || t('무제', 'Untitled'), snapshot())
      await saveBlob(blob, `${name.trim() || t('무제', 'Untitled')}.scut.json`)
    } catch (error) {
      if ((error as Error).name !== 'AbortError') alert(localizedErrorMessage(error, '파일을 만들지 못했습니다.', 'Could not create the file.'))
    } finally { setBusy('') }
  }
  const doShareFile = async () => {
    setBusy(t('공유 파일 만드는 중…', 'Creating share file…'))
    try {
      const projectName = name.trim() || t('무제', 'Untitled')
      const blob = await projectToFileBlob(projectName, snapshot())
      const file = new File([blob], `${projectName}.scut`, { type: 'application/json' })
      if (!navigator.share || !navigator.canShare?.({ files: [file] })) throw new Error(t('이 기기에서는 파일 공유를 지원하지 않습니다.', 'File sharing is not supported on this device.'))
      await navigator.share({ title: t(`${projectName} — SimpleCut 프로젝트`, `${projectName} — SimpleCut project`), files: [file] })
    } catch (error) {
      if ((error as Error).name !== 'AbortError') alert(localizedErrorMessage(error, '파일을 공유하지 못했습니다.', 'Could not share the file.'))
    } finally { setBusy('') }
  }
  const doImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy(t('가져오는 중…', 'Importing…'))
    try {
      const imported = await fileBlobToProjectWithMeta(f)
      replaceProject(imported.project)
      onActiveProjectChange(imported.name)
      onClose()
    }
    catch (err) { alert(t('가져오기 실패: ', 'Import failed: ') + localizedErrorMessage(err, '알 수 없는 오류', 'Unknown error')) }
    finally { setBusy('') }
  }

  return (
    <div className="modal" onClick={busy ? undefined : onClose}>
      <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>{t('프로젝트', 'Project')}</h2>
          {!busy && <button className="iconbtn" onClick={onClose} aria-label={t('닫기', 'Close')}><Icon name="close" /></button>}
        </div>

        <div className="modal__field project-save">
          <span>{t('현재 프로젝트', 'Current project')}</span>
          <div className="project-save__current">
            <div>
              <b>{activeName || t('아직 이름 없음', 'Untitled')}</b>
              <small>{activeName ? t('저장을 누르면 이 프로젝트에 덮어씁니다.', 'Save will overwrite this project.') : t('처음 저장할 이름을 정해주세요.', 'Choose a name for your first save.')}</small>
            </div>
            {activeName && <button className="btn btn--primary" onClick={doSave} disabled={!!busy}><Icon name="save" />{t('저장', 'Save')}</button>}
          </div>
          {!saveAs && activeName && (
            <button className="btn btn--sm project-save__as" onClick={() => { setName(t(`${activeName} 복사본`, `${activeName} copy`)); setSaveAs(true) }} disabled={!!busy}>
              {t('다른 이름으로 저장…', 'Save as…')}
            </button>
          )}
          {saveAs && (
            <div className="filename">
              <input className="filename__input" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label={t('새 프로젝트 이름', 'New project name')} />
              <button className="btn btn--primary" onClick={doSaveAs} disabled={!!busy || !name.trim()}><Icon name="save" />{activeName ? t('새로 저장', 'Save new') : t('저장', 'Save')}</button>
              {activeName && <button className="btn btn--sm" onClick={() => setSaveAs(false)} disabled={!!busy}>{t('취소', 'Cancel')}</button>}
            </div>
          )}
        </div>

        <div className="modal__field">
          <span>{t('저장된 프로젝트', 'Saved projects')}</span>
          {projects.length === 0 ? (
            <div className="modal__hint">{t('저장된 프로젝트가 없습니다.', 'No saved projects.')}</div>
          ) : (
            <div className="projlist">
              {projects.map((p) => (
                <div className="projrow" key={p.name}>
                  <div className="projrow__info">
                    <b>{p.name}{p.name === activeName && <span className="projrow__current">{t('현재 열림', 'Open')}</span>}</b>
                    <small>{new Date(p.savedAt).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US')} · {(p.size / 1024 / 1024).toFixed(1)}MB</small>
                  </div>
                  <button className="btn btn--sm" onClick={() => doLoad(p.name)} disabled={!!busy}>{t('열기', 'Open')}</button>
                  <button className="btn btn--sm btn--danger" onClick={() => doDelete(p.name)} disabled={!!busy}>{t('삭제', 'Delete')}</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal__field">
          <span>{t('파일로 백업 (아이클라우드 드라이브 등)', 'File backup (iCloud Drive, etc.)')}</span>
          <div className="inspector__row">
            <button className="btn btn--sm" onClick={doExportFile} disabled={!!busy}><Icon name="upload" />{t('파일로 내보내기', 'Export file')}</button>
            <button className="btn btn--sm" onClick={doShareFile} disabled={!!busy}><Icon name="share" />{t('공유하기', 'Share')}</button>
            <button className="btn btn--sm" onClick={() => fileRef.current?.click()} disabled={!!busy}><Icon name="download" />{t('파일에서 가져오기', 'Import file')}</button>
          </div>
          <div className="modal__hint">{t('저장 위치 선택을 지원하면 아이클라우드 드라이브 폴더에 바로 저장할 수 있어요.', 'When folder selection is supported, you can save directly to iCloud Drive.')}</div>
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
