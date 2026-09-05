/** Composer left-row controls: optimize draft + optional local voice capture. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputOptimizeControlsInjected } from './index.ts'
import css from './InputOptimizeControls.module.css'

export type InputOptimizeControlsProps =
  PropsRuntime<'conversation.input.left'>
  & InjectFace<InputOptimizeControlsInjected>
  & PropsLocale<'inputOptimize'>

/**
 * Compact optimize / mic controls. Optimized text replaces the draft for
 * explicit user confirmation before send.
 */
export function InputOptimizeControls({
  useInput,
  inputActions,
  t,
  status,
  optimizeText,
  transcribe,
}: InputOptimizeControlsProps) {
  const input = useInput(s => s)
  const [busy, setBusy] = useState<'idle' | 'optimize' | 'record'>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const [available, setAvailable] = useState<{ optimize: boolean; stt: boolean }>({
    optimize: false,
    stt: false,
  })
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    void status().then((snap) => {
      if (!aliveRef.current) return
      setAvailable({ optimize: snap.optimizeAvailable, stt: snap.sttAvailable })
    }, () => {
      if (!aliveRef.current) return
      setAvailable({ optimize: false, stt: false })
    })
    return () => {
      aliveRef.current = false
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
    }
  }, [status])

  const draft = input?.draft ?? ''
  const locked = input === undefined
    || input.phase === 'submitting'
    || input.phase === 'adjudicating'
    || input.phase === 'claimed'

  const onOptimize = useCallback(() => {
    if (locked || busy !== 'idle' || draft.trim() === '') return
    setBusy('optimize')
    setNotice(null)
    void optimizeText(draft).then((text) => {
      if (!aliveRef.current) return
      inputActions.setDraft(text)
      setNotice(t('confirm.hint'))
      setBusy('idle')
    }, (err: unknown) => {
      if (!aliveRef.current) return
      setBusy('idle')
      setNotice(err instanceof Error ? err.message : t('optimize.failed'))
    })
  }, [locked, busy, draft, optimizeText, inputActions, t])

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }, [])

  const onMic = useCallback(() => {
    if (locked || busy === 'optimize') return
    if (busy === 'record') {
      stopRecording()
      return
    }
    if (!available.stt) {
      setNotice(t('mic.unavailable'))
      return
    }
    if (typeof MediaRecorder === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      setNotice(t('mic.unavailable'))
      return
    }
    setNotice(null)
    void navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (!aliveRef.current) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorderRef.current = recorder
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data)
      }
      recorder.onstop = () => {
        for (const track of stream.getTracks()) track.stop()
        recorderRef.current = null
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        chunksRef.current = []
        void blob.arrayBuffer().then((buf) => {
          const bytes = new Uint8Array(buf)
          let binary = ''
          for (const b of bytes) binary += String.fromCharCode(b)
          const base64 = btoa(binary)
          return transcribe(base64, blob.type || 'audio/webm')
        }).then((text) => {
          if (!aliveRef.current) return
          inputActions.setDraft(text)
          setBusy('idle')
          setNotice(t('confirm.hint'))
        }, (err: unknown) => {
          if (!aliveRef.current) return
          setBusy('idle')
          setNotice(err instanceof Error ? err.message : t('mic.failed'))
        })
      }
      recorder.start()
      setBusy('record')
    }, () => {
      if (!aliveRef.current) return
      setNotice(t('mic.unavailable'))
    })
  }, [locked, busy, available.stt, stopRecording, transcribe, inputActions, t])

  if (input === undefined) return null

  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={css.btn}
        aria-label={t('optimize.aria')}
        title={available.optimize ? t('optimize.title') : t('optimize.unavailable')}
        disabled={locked || busy !== 'idle' || !available.optimize || draft.trim() === ''}
        onClick={onOptimize}
      >
        {busy === 'optimize' ? t('optimize.busy') : t('optimize.label')}
      </button>
      <button
        type="button"
        className={busy === 'record' ? `${css.btn} ${css.recording}` : css.btn}
        aria-label={t('mic.aria')}
        title={available.stt ? t('mic.title') : t('mic.unavailable')}
        disabled={locked || busy === 'optimize' || !available.stt}
        onClick={onMic}
      >
        {busy === 'record' ? t('mic.recording') : t('mic.label')}
      </button>
      {notice !== null && <span className={css.status} role="status">{notice}</span>}
    </span>
  )
}
