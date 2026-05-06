import Topbar from './components/Topbar'
import DashboardPage from './pages/DashboardPage'
import InjectPage from './pages/InjectPage'
import PromptPage from './pages/PromptPage'
import ModelPage from './pages/ModelPage'
import ResultsPage from './pages/ResultsPage'
import useStore from './store'

const PAGES = [DashboardPage, InjectPage, PromptPage, ModelPage, ResultsPage]

export default function App() {
  const currentStep = useStore((s) => s.currentStep)
  const Page = PAGES[currentStep] || InjectPage

  return (
    <div className="min-h-screen bg-bg font-sora text-t1">
      <Topbar />
      <div className="pt-14">
        <Page />
      </div>
    </div>
  )
}
