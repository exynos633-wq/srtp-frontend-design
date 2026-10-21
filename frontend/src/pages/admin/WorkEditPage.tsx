import { useParams } from 'react-router'
import WorkFormPage from './WorkFormPage'

export default function WorkEditPage() {
  const { id } = useParams<{ id: string }>()

  if (!id) {
    return (
      <p role="alert" style={{ paddingTop: 'var(--space-6)' }}>
        作品编号缺失，无法编辑。
      </p>
    )
  }

  return <WorkFormPage key={id} workId={id} />
}
