/* 离线中文语音识别：vosk wasm + 本地小模型，全程不联网 */
(function (global) {
  'use strict';

  const MODEL_URL = '/assets/model.tar.gz';

  class OfflineASR {
    constructor(opts) {
      opts = opts || {};
      this.onStatus = opts.onStatus || function () {};
      this.onText = opts.onText || function () {};
      this.onLevel = opts.onLevel || function () {};
      this.model = null;
      this.loadingPromise = null;
      this.running = false;
    }

    get available() { return !!global.Vosk; }

    async probe() {
      try {
        const r = await fetch(MODEL_URL, { headers: { Range: 'bytes=0-0' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const len = r.headers.get('Content-Range') || r.headers.get('Content-Length') || '';
        return { ok: true, info: len };
      } catch (e) { return { ok: false, error: String(e.message || e) }; }
    }

    async load() {
      if (this.model) return this.model;
      if (this.loadingPromise) return this.loadingPromise;
      if (!global.Vosk) throw new Error('语音引擎未加载（vendor/vosk.js 缺失）');

      this.loadingPromise = (async () => {
        const probe = await this.probe();
        if (!probe.ok) throw new Error('找不到离线模型：' + probe.error);
        this.onStatus('loading', '正在加载离线中文模型（首次约需 10–40 秒，之后会缓存）');

        const model = new global.Vosk.Model(MODEL_URL, -1);
        await new Promise((resolve, reject) => {
          let settled = false;
          const finish = (fn, arg) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(arg);
          };
          const timer = setTimeout(() => finish(reject, new Error('模型加载超时，请重试或改用定速模式')), 180000);
          model.on('load', (m) => m.result
            ? finish(resolve, true)
            : finish(reject, new Error('模型初始化失败')));
          model.on('error', (m) => finish(reject, new Error(m.error || '模型加载出错')));
        });

        this.model = model;
        this.onStatus('ready', '离线模型已就绪');
        return model;
      })().catch(e => { this.loadingPromise = null; throw e; });

      return this.loadingPromise;
    }

    async start() {
      if (this.running) return;
      if (this.startingPromise) return this.startingPromise;
      this.startingPromise = this._start().finally(() => { this.startingPromise = null; });
      return this.startingPromise;
    }

    async _start() {
      await this.load();
      this.onStatus('starting', '正在打开麦克风…');

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: {
            channelCount: 1, sampleRate: 16000,
            echoCancellation: true, noiseSuppression: true, autoGainControl: true
          }
        });
      } catch (e) {
        throw new Error('无法访问麦克风：' + (e.message || e));
      }

      const Ctx = global.AudioContext || global.webkitAudioContext;
      let ctx;
      try { ctx = new Ctx({ sampleRate: 16000 }); await ctx.resume(); }
      catch (_) { ctx = new Ctx(); await ctx.resume(); }

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const rec = new this.model.KaldiRecognizer(ctx.sampleRate);
      if (typeof rec.setWords === 'function') rec.setWords(false);

      rec.on('result', (m) => {
        const text = m && m.result && m.result.text;
        if (text) this.onText(text, true);
      });
      rec.on('partialresult', (m) => {
        const text = m && m.result && m.result.partial;
        if (text) this.onText(text, false);
      });

      let lastLevelAt = 0;
      processor.onaudioprocess = (e) => {
        const buf = e.inputBuffer;
        try { rec.acceptWaveform(buf); }
        catch (err) { console.warn('[asr] acceptWaveform', err); }
        const now = performance.now();
        if (now - lastLevelAt > 90) {
          lastLevelAt = now;
          const d = buf.getChannelData(0);
          let sum = 0;
          for (let i = 0; i < d.length; i += 8) sum += d[i] * d[i];
          this.onLevel(Math.min(1, Math.sqrt(sum / (d.length / 8)) * 6));
        }
      };

      source.connect(processor);
      // 必须连到 destination 才会触发 onaudioprocess；输出缓冲保持静音，不会回放麦克风声音
      processor.connect(ctx.destination);

      this.stream = stream; this.ctx = ctx; this.source = source;
      this.processor = processor; this.rec = rec;
      this.running = true;
      this.onStatus('listening', '正在聆听…');
    }

    stop() {
      if (!this.running) return;
      this.running = false;
      try { this.processor.onaudioprocess = null; } catch (_) {}
      try { this.source.disconnect(); this.processor.disconnect(); } catch (_) {}
      try { this.rec.remove(); } catch (_) {}
      try { this.stream.getTracks().forEach(t => t.stop()); } catch (_) {}
      try { this.ctx.close(); } catch (_) {}
      this.rec = this.processor = this.source = this.stream = this.ctx = null;
      this.onLevel(0);
      this.onStatus('idle', '已停止');
    }
  }

  global.TP.OfflineASR = OfflineASR;
  global.TP.MODEL_URL = MODEL_URL;
})(window);
