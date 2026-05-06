import { create } from 'zustand'

const useStore = create((set) => ({
  currentStep: 1,
  sessionStartedAt: Date.now() / 1000,
  fileStatuses: [],
  uploadedFileIds: [],
  prompt: '',
  slmResult: null,
  modelRecommendations: [],
  selectedModel: null,
  decisionData: null,
  finalRunResult: null,
  dashboardStats: null,
  isAnalysing: false,
  isRunning: false,
  error: null,

  setStep: (step) => set({ currentStep: step }),
  setPrompt: (prompt) => set({ prompt }),

  setFileStatuses: (fileStatuses) => set({ fileStatuses }),

  addFile: (status) =>
    set((state) => ({
      fileStatuses: [
        status,
        ...state.fileStatuses.filter((s) => s.file_id !== status.file_id),
      ],
      uploadedFileIds: [...new Set([...state.uploadedFileIds, status.file_id])],
    })),

  updateFile: (fileId, updates) =>
    set((state) => ({
      fileStatuses: state.fileStatuses.map((s) =>
        s.file_id === fileId ? { ...s, ...updates } : s
      ),
    })),

  setAnalyseResult: (result) =>
    set({
      slmResult: result?.slm_result ?? null,
      modelRecommendations: result?.model_recommendations ?? [],
      decisionData: result?.decision ?? null,
      selectedModel: result?.model_recommendations?.[0]?.model?.id ?? null,
    }),

  setSelectedModel: (model) => set({ selectedModel: model }),
  setFinalRunResult: (result) => set({ finalRunResult: result }),
  setDashboardStats: (stats) => set({ dashboardStats: stats }),
  setAnalysing: (v) => set({ isAnalysing: v }),
  setRunning: (v) => set({ isRunning: v }),
  setError: (error) => set({ error }),

  startNewSession: () =>
    set({
      currentStep: 1,
      sessionStartedAt: Date.now() / 1000,
      fileStatuses: [],
      uploadedFileIds: [],
      prompt: '',
      slmResult: null,
      modelRecommendations: [],
      selectedModel: null,
      decisionData: null,
      finalRunResult: null,
      isAnalysing: false,
      isRunning: false,
      error: null,
    }),
}))

export default useStore
