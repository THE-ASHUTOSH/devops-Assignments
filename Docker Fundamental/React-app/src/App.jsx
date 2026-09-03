import { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)

  return (
    <div style={{ fontFamily: 'system-ui', padding: '2rem' }}>
      <h1>Hello World from React</h1>
      <p>built with vite, served by nginx</p>
      <button onClick={() => setCount(count + 1)}>clicked {count} times</button>
    </div>
  )
}
