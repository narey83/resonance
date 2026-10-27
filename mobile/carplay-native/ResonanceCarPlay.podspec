Pod::Spec.new do |s|
  s.name = 'ResonanceCarPlay'
  s.version = '1.0.0'
  s.summary = 'Resonance CarPlay audio browser'
  s.homepage = 'https://github.com/resonance'
  s.license = { :type => 'AGPL-3.0-only' }
  s.author = 'Resonance'
  s.source = { :path => '.' }
  s.platform = :ios, '16.4'
  s.source_files = '*.{h,mm}'
  s.frameworks = 'CarPlay', 'MediaPlayer', 'UIKit'
  s.dependency 'React-Core'
end
